package com.marta.tracker.martatransportationtracker.controller;

import com.marta.tracker.martatransportationtracker.model.MartaTrain;
import com.marta.tracker.martatransportationtracker.service.MartaService;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@CrossOrigin(origins = "http://localhost:4200")
@RestController
@RequestMapping("/api")
public class MartaTrainController {

    private MartaService service;

    public MartaTrainController(MartaService service){
        this.service = service;
    }

    @GetMapping(value = "/trains")
    public List<MartaTrain> getTrains(){
        return service.getLiveTrains();
    }

}
