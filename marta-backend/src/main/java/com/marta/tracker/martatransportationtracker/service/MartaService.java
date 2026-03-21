package com.marta.tracker.martatransportationtracker.service;

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

import java.util.Arrays;
import java.util.List;

@Service
public class MartaService {
    // Can be replaced by using Log4j annotation I believe.
    private static final Logger log = LoggerFactory.getLogger(MartaService.class);

    private final String MARTA_URL = "https://developerservices.itsmarta.com:18096/itsmarta/railrealtimearrivals/developerservices/traindata";

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
}