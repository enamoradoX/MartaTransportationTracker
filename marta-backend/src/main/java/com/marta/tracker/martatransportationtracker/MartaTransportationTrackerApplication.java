package com.marta.tracker.martatransportationtracker;

import com.marta.tracker.martatransportationtracker.model.MartaTrain;
import com.marta.tracker.martatransportationtracker.service.MartaService;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

@SpringBootApplication
public class MartaTransportationTrackerApplication {

    public static void main(String[] args) {
        SpringApplication.run(MartaTransportationTrackerApplication.class, args);
    }

    @Bean
    public CommandLineRunner run(MartaService service) {

        return  args -> {
            service.getLiveTrains();
        };
    }

}
