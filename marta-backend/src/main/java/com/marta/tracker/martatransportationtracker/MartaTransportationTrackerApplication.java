package com.marta.tracker.martatransportationtracker;

import com.marta.tracker.martatransportationtracker.service.MartaService;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;

@SpringBootApplication
public class MartaTransportationTrackerApplication {

    public static void main(String[] args) {
        SpringApplication.run(MartaTransportationTrackerApplication.class, args);
    }

}
