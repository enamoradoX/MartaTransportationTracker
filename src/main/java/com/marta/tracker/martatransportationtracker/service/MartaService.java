package com.marta.tracker.martatransportationtracker.service;

import com.marta.tracker.martatransportationtracker.model.MartaTrain;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import java.util.Arrays;
import java.util.List;

@Service
public class MartaService {
    private final String MARTA_URL = "https://developerservices.itsmarta.com:18096/itsmarta/railrealtimearrivals/developerservices/traindata";

    @Value("${marta.api.key}")
    private String apiKey;

    private final RestTemplate restTemplate;

    public MartaService(RestTemplate restTemplate){
        this.restTemplate = restTemplate;
    }

    public List<MartaTrain> getLiveTrains() {
        System.out.println("🚀 Fetching MARTA with Header Auth...");

        HttpHeaders headers = new HttpHeaders();
        headers.set("api_key", apiKey);
        headers.set("User-Agent", "Spring-Boot-Marta-App");

        HttpEntity<String> entity = new HttpEntity<>(headers);

        try {
            // Since MARTA returns a JSON array [], we fetch it as an array of our Objects
            ResponseEntity<MartaTrain[]> response = restTemplate.exchange(
                    MARTA_URL,
                    HttpMethod.GET,
                    entity,
                    MartaTrain[].class);

            MartaTrain[] trains = response.getBody();

            if (trains != null && trains.length > 0) {
                System.out.println("✅ Connection Successful! Found " + trains.length + " active trains.");

                // Print the first 3 trains to keep the console clean
                for (int i = 0; i < Math.min(trains.length, 3); i++) {
                    MartaTrain t = trains[i];
                    System.out.printf("📍 [%s Line] Train %s at %s - Arriving in: %s%n",
                            t.getLine(), t.getTrainId(), t.getStation(), t.getWaitingTime());
                }
                System.out.println("--- 🚆 TEST COMPLETE ---\n");
                return Arrays.asList(trains);
            } else {
                System.out.println("⚠️ Connected, but MARTA returned an empty list (maybe no trains running?).");
            }
        } catch (Exception e) {
            System.err.println("❌ ERROR: Could not connect to MARTA.");
            System.err.println("Message: " + e.getMessage());
        }
        return List.of(); // Return empty list on failure
    }
}