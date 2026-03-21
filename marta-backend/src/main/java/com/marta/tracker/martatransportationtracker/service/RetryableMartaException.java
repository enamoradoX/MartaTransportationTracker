package com.marta.tracker.martatransportationtracker.service;

public class RetryableMartaException extends RuntimeException {

    public RetryableMartaException(String message, Throwable cause) {
        super(message, cause);
    }
}

