package com.marta.tracker.martatransportationtracker.configuration;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.retry.annotation.EnableRetry;
import org.springframework.web.client.RestTemplate;

@Configuration
@EnableRetry
public class config {

    @Bean
    public RestTemplate restTemplate(
            @Value("${marta.http.connect-timeout-ms:2000}") int connectTimeoutMs,
            @Value("${marta.http.read-timeout-ms:3000}") int readTimeoutMs) {
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(connectTimeoutMs);
        requestFactory.setReadTimeout(readTimeoutMs);

        return new RestTemplate(requestFactory);
    }
}
