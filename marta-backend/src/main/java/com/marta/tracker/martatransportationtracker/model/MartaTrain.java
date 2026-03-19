package com.marta.tracker.martatransportationtracker.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

@Data
public class MartaTrain {
    @JsonProperty("DESTINATION")
    private String destination;

    @JsonProperty("LINE")
    private String line;

    @JsonProperty("STATION")
    private String station;

    @JsonProperty("WAITING_TIME")
    private String waitingTime;

    @JsonProperty("WAITING_SECONDS")
    private String waitingSeconds;

    @JsonProperty("IS_REALTIME")
    private String isRealtime;

    @JsonProperty("DELAY")
    private String delay;

    @JsonProperty("TRAIN_ID")
    private String trainId;
}
