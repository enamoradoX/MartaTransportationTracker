package com.marta.tracker.martatransportationtracker.controller;

import com.google.transit.realtime.GtfsRealtime;
import com.marta.tracker.martatransportationtracker.model.MartaTrain;
import com.marta.tracker.martatransportationtracker.service.MartaService;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import com.google.transit.realtime.GtfsRealtime.FeedMessage;
import com.google.transit.realtime.GtfsRealtime.FeedEntity;

import java.io.IOException;
import java.io.InputStream;
import java.net.MalformedURLException;
import java.net.URL;

import java.net.URLConnection;
import java.util.List;

@CrossOrigin(origins = "http://localhost:4200")
@RestController
@RequestMapping("/api")
public class MartaTrainController {

    private final MartaService service;

    public MartaTrainController(MartaService service){
        this.service = service;
    }

    @GetMapping(value = "/trains")
    public List<MartaTrain> getTrains(){
        return service.getLiveTrains();
    }

    @GetMapping(value = "/buses")
    public void getBuses() throws Exception {
        FeedMessage feed = service.fetchBusPositions();

        System.out.println("Success! Found " + feed.getEntityCount() + " buses.");

        for (FeedEntity entity : feed.getEntityList()) {
            if (entity.hasVehicle()) {
                var v = entity.getVehicle();
                System.out.printf("Bus ID: %s | Route: %s | Lat: %f | Lon: %f%n",
                        v.getVehicle().getId(),
                        v.getTrip().getRouteId(),
                        v.getPosition().getLatitude(),
                        v.getPosition().getLongitude());
            }
        }
    }
}
