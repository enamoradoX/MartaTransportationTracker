package com.marta.tracker.martatransportationtracker.service;

import com.google.transit.realtime.GtfsRealtime;
import com.marta.tracker.martatransportationtracker.model.MartaTrain;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.retry.annotation.Backoff;
import org.springframework.retry.annotation.Recover;
import org.springframework.retry.annotation.Retryable;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.client.RestTemplate;

import java.io.BufferedInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;
import java.util.List;
import java.util.zip.GZIPInputStream;

@Service
public class MartaService {
    // Can be replaced by using Log4j annotation I believe.
    private static final Logger log = LoggerFactory.getLogger(MartaService.class);

    @Value("${marta.train.url}")
    private String MARTA_URL;
    
    @Value("${marta.bus.feed.url:https://gtfs-rt.itsmarta.com/vehicle-positions.pb}")
    private String BUS_FEED_URL;

    @Value("${marta.api.key}")
    private String apiKey;

    private final RestTemplate restTemplate;

    public MartaService(RestTemplate restTemplate){
        this.restTemplate = restTemplate;
    }

    @Retryable(
            retryFor = RetryableMartaException.class,
            maxAttemptsExpression = "${marta.retry.max-attempts:3}",
            backoff = @Backoff(
                    delayExpression = "${marta.retry.initial-delay-ms:500}",
                    multiplierExpression = "${marta.retry.multiplier:2.0}",
                    maxDelayExpression = "${marta.retry.max-delay-ms:4000}"))
    public List<MartaTrain> getLiveTrains() {
        log.info("Fetching live train data from MARTA");

        if (apiKey == null || apiKey.isBlank()) {
            log.error("MARTA API key is missing or blank; skipping upstream request");
            return List.of();
        }

        HttpHeaders headers = new HttpHeaders();
        headers.set("api_key", apiKey);
        headers.set("User-Agent", "Spring-Boot-Marta-App");

        HttpEntity<String> entity = new HttpEntity<>(headers);

        try {
            ResponseEntity<MartaTrain[]> response = restTemplate.exchange(
                    MARTA_URL,
                    HttpMethod.GET,
                    entity,
                    MartaTrain[].class);

            MartaTrain[] trains = response.getBody();

            if (trains != null && trains.length > 0) {
                log.info("MARTA request succeeded with {} active trains", trains.length);

                for (int i = 0; i < Math.min(3, trains.length); i++) {
                    MartaTrain t = trains[i];
                    log.debug("Train sample [{} Line] Train {} at {} arriving in {}",
                            t.getLine(), t.getTrainId(), t.getStation(), t.getWaitingTime());
                }

                return Arrays.asList(trains);
            }

            log.warn("Connected to MARTA, but it returned an empty train list");
            return List.of();
        } catch (HttpClientErrorException.TooManyRequests ex) {
            log.warn("MARTA rate limited the request with status 429; retrying with backoff");
            throw new RetryableMartaException("MARTA rate limited the request", ex);
        } catch (HttpServerErrorException | ResourceAccessException ex) {
            log.warn("Transient MARTA failure detected: {}. Retrying with backoff.", ex.getMessage());
            throw new RetryableMartaException("Transient MARTA failure", ex);
        } catch (RestClientResponseException ex) {
            log.error("Non-retriable MARTA response: status={}, body={}", ex.getStatusCode(), ex.getResponseBodyAsString());
        } catch (RestClientException ex) {
            log.error("Non-retriable MARTA client error: {}", ex.getMessage(), ex);
        }

        return List.of();
    }

    @Recover
    public List<MartaTrain> recover(RetryableMartaException ex) {
        log.error("MARTA request failed after retries were exhausted: {}", ex.getMessage(), ex);
        return List.of();
    }

    /**
     * Common GTFS Realtime endpoint paths to try if the configured one doesn't work.
     * Used as fallback when primary endpoint returns 404.
     */
    private static final String[] GTFS_ENDPOINT_FALLBACKS = {
            "/realtime/vehicle-positions.pb",
            "/realtime/vehicle-positions",
            "/vehicle-positions.pb",
            "/vehicle-positions",
            "/feed/vehicle-positions.pb",
            "/gtfs_realtime/vehicle-positions.pb"
    };

    public GtfsRealtime.FeedMessage fetchBusPositions() throws Exception {
        // Try the configured URL first
        GtfsRealtime.FeedMessage result = tryFetchFromUrl(BUS_FEED_URL);
        if (result != null) {
            return result;
        }

        // If configured URL returns 404, try fallback paths on the same domain
        String domain = extractDomain(BUS_FEED_URL);
        for (String fallbackPath : GTFS_ENDPOINT_FALLBACKS) {
            String fallbackUrl = domain + fallbackPath;
            log.info("Trying fallback GTFS endpoint: {}", fallbackUrl);
            result = tryFetchFromUrl(fallbackUrl);
            if (result != null) {
                log.info("SUCCESS: Found working GTFS endpoint at {}", fallbackUrl);
                return result;
            }
        }

        // All endpoints failed, return empty feed
        log.warn("All GTFS Realtime endpoint paths returned errors. Returning empty feed.");
        return createEmptyFeedMessage();
    }

    /**
     * Attempts to fetch GTFS Realtime data from the given URL.
     * Returns null if endpoint not found (404) or returns errors.
     * Returns a FeedMessage on success or gracefully degraded response.
     */
    private GtfsRealtime.FeedMessage tryFetchFromUrl(String feedUrl) throws Exception {
        return tryFetchFromUrlInternal(feedUrl, 0);
    }

    /**
     * Internal method that handles redirect following manually if needed.
     * 
     * @param feedUrl the URL to fetch from
     * @param redirectCount the number of redirects followed (to prevent infinite loops)
     * @return FeedMessage on success, empty FeedMessage on graceful failure, or null if should try next fallback
     */
    private GtfsRealtime.FeedMessage tryFetchFromUrlInternal(String feedUrl, int redirectCount) throws Exception {
        // Prevent infinite redirect loops
        if (redirectCount > 5) {
            log.warn("Too many redirects (>5) for GTFS endpoint {}", feedUrl);
            return createEmptyFeedMessage();
        }

        URL url = new URL(feedUrl);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();

        // Enable automatic redirect following for 301/302/303/307/308 responses
        connection.setInstanceFollowRedirects(true);
        
        // Use standard headers to avoid 406 or 403 errors
        connection.setRequestMethod("GET");
        connection.setRequestProperty("Accept", "application/x-protobuf, */*");
        connection.setRequestProperty("User-Agent", "Mozilla/5.0");
        connection.setRequestProperty("Accept-Encoding", "gzip");

        connection.setConnectTimeout(10000);
        connection.setReadTimeout(10000);

        int responseCode = connection.getResponseCode();
        String contentType = connection.getContentType();
        String contentEncoding = connection.getContentEncoding();
        String redirectLocation = connection.getHeaderField("Location");
        
        log.debug("GTFS Realtime Response from {}: code={}, contentType={}, encoding={}", 
                 feedUrl, responseCode, contentType, contentEncoding);
        
        // Log redirect location if present
        if (redirectLocation != null) {
            log.info("GTFS endpoint {} (attempt {}) redirects to: {}", feedUrl, redirectCount + 1, redirectLocation);
        }

        // Handle redirect responses manually in case automatic following didn't work
        if (responseCode >= 300 && responseCode < 400 && redirectLocation != null) {
            log.debug("Following redirect from {} to {}", feedUrl, redirectLocation);
            // Recursively follow the redirect
            return tryFetchFromUrlInternal(redirectLocation, redirectCount + 1);
        }

        // Handle non-200 responses gracefully
        if (responseCode != 200) {
            InputStream errorStream = connection.getErrorStream();
            String errorBody = errorStream != null ? readStream(errorStream) : "(no body)";
            
            if (responseCode == 404) {
                log.debug("GTFS endpoint {} returned 404 - will try next path", feedUrl);
                return null; // Signal to try next fallback
            } else if (responseCode >= 300 && responseCode < 400) {
                // Redirect codes without Location header - can't follow
                log.warn("GTFS endpoint {} returned redirect code {} but no Location header", feedUrl, responseCode);
            } else {
                log.warn("GTFS Realtime HTTP Error {} from {}", responseCode, feedUrl);
            }
            
            // Return empty feed for non-404 errors
            return createEmptyFeedMessage();
        }

        
        // Read entire response into byte array to avoid stream corruption
        byte[] responseBytes;
        try (InputStream is = connection.getInputStream()) {
            responseBytes = is.readAllBytes();
        }

        log.debug("Received {} bytes from GTFS Realtime endpoint", responseBytes.length);
        
        // Validate we got reasonable data
        if (responseBytes.length == 0) {
            log.warn("GTFS Realtime endpoint returned empty response");
            return createEmptyFeedMessage();
        }

        // Handle GZIP decompression if server sent it
        if ("gzip".equalsIgnoreCase(contentEncoding)) {
            log.debug("Decompressing gzip response");
            try (GZIPInputStream gzipStream = new GZIPInputStream(new java.io.ByteArrayInputStream(responseBytes))) {
                byte[] decompressed = gzipStream.readAllBytes();
                log.debug("Decompressed {} bytes -> {} bytes", responseBytes.length, decompressed.length);
                responseBytes = decompressed;
            } catch (Exception gzipEx) {
                log.warn("Failed to decompress gzip response, treating as raw bytes. Error: {}", gzipEx.getMessage());
            }
        }

        // Check if we got HTML instead of protobuf (indicates an error page)
        if ("text/html".equalsIgnoreCase(contentType)) {
            String htmlResponse = new String(responseBytes, java.nio.charset.StandardCharsets.UTF_8);
            log.warn("GTFS endpoint {} returned HTML instead of protobuf", feedUrl);
            return createEmptyFeedMessage();
        }

        // Parse the complete byte array as protobuf
        log.debug("Parsing {} bytes of GTFS realtime data as protobuf", responseBytes.length);
        try {
            GtfsRealtime.FeedMessage message = GtfsRealtime.FeedMessage.parseFrom(responseBytes);
            log.info("Successfully parsed GTFS realtime feed with {} entities", message.getEntityCount());
            return message;
        } catch (com.google.protobuf.InvalidProtocolBufferException parseEx) {
            log.warn("Failed to parse GTFS realtime protobuf from {} bytes at {}", responseBytes.length, feedUrl);
            return createEmptyFeedMessage();
        }
    }

    /**
     * Extracts the domain (scheme + host) from a URL.
     * Example: https://gtfs-rt.itsmarta.com/path/to/feed -> https://gtfs-rt.itsmarta.com
     */
    private String extractDomain(String urlString) {
        try {
            URL url = new URL(urlString);
            String protocol = url.getProtocol();
            String host = url.getHost();
            int port = url.getPort();
            
            if (port == -1) {
                return protocol + "://" + host;
            } else {
                return protocol + "://" + host + ":" + port;
            }
        } catch (Exception e) {
            log.warn("Failed to extract domain from URL: {}", urlString, e);
            return "https://gtfs-rt.itsmarta.com";
        }
    }

    /**
     * Creates an empty but valid GTFS Realtime FeedMessage.
     */
    private GtfsRealtime.FeedMessage createEmptyFeedMessage() {
        return GtfsRealtime.FeedMessage.newBuilder()
                .setHeader(GtfsRealtime.FeedHeader.newBuilder()
                        .setGtfsRealtimeVersion("2.0")
                        .setTimestamp(System.currentTimeMillis() / 1000)
                        .build())
                .build();
    }

    /**
     * Helper method to read an InputStream into a String.
     * Used for error responses and debugging.
     *
     * @param stream the input stream to read
     * @return the stream contents as a UTF-8 string, or empty string if stream is null
     * @throws java.io.IOException if reading fails
     */
    private String readStream(InputStream stream) throws java.io.IOException {
        if (stream == null) {
            return "";
        }
        try (stream) {
            return new String(stream.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
        }
    }

}