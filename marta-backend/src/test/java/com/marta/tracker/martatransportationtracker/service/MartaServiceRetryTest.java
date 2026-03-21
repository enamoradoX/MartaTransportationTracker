package com.marta.tracker.martatransportationtracker.service;

import com.marta.tracker.martatransportationtracker.model.MartaTrain;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.ExpectedCount;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

@SpringBootTest(properties = {
        "marta.api.key=test-key",
        "marta.retry.max-attempts=3",
        "marta.retry.initial-delay-ms=1",
        "marta.retry.multiplier=2.0",
        "marta.retry.max-delay-ms=2",
        "marta.http.connect-timeout-ms=1000",
        "marta.http.read-timeout-ms=1000"
})
class MartaServiceRetryTest {

    private static final String MARTA_URL = "https://developerservices.itsmarta.com:18096/itsmarta/railrealtimearrivals/developerservices/traindata";

    @Autowired
    private MartaService martaService;

    @Autowired
    private RestTemplate restTemplate;

    private MockRestServiceServer mockServer;

    @BeforeEach
    void setUp() {
        mockServer = MockRestServiceServer.bindTo(restTemplate).build();
    }

    @AfterEach
    void tearDown() {
        mockServer.verify();
    }

    @Test
    void getLiveTrainsReturnsDataWhenFirstAttemptSucceeds() {
        mockServer.expect(ExpectedCount.once(), requestTo(MARTA_URL))
                .andExpect(method(HttpMethod.GET))
                .andExpect(header("api_key", "test-key"))
                .andRespond(withSuccess(singleTrainJson(), MediaType.APPLICATION_JSON));

        List<MartaTrain> trains = martaService.getLiveTrains();

        assertThat(trains)
                .hasSize(1)
                .first()
                .extracting(MartaTrain::getLine, MartaTrain::getTrainId, MartaTrain::getStation)
                .containsExactly("RED", "101", "Midtown");
    }

    @Test
    void getLiveTrainsRetriesAndEventuallySucceeds() {
        mockServer.expect(ExpectedCount.once(), requestTo(MARTA_URL))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE));
        mockServer.expect(ExpectedCount.once(), requestTo(MARTA_URL))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withStatus(HttpStatus.GATEWAY_TIMEOUT));
        mockServer.expect(ExpectedCount.once(), requestTo(MARTA_URL))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess(singleTrainJson(), MediaType.APPLICATION_JSON));

        List<MartaTrain> trains = martaService.getLiveTrains();

        assertThat(trains).hasSize(1);
        assertThat(trains.getFirst().getDestination()).isEqualTo("Airport");
    }

    @Test
    void getLiveTrainsReturnsEmptyListAfterRetriesAreExhausted() {
        mockServer.expect(ExpectedCount.once(), requestTo(MARTA_URL))
                .andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE));
        mockServer.expect(ExpectedCount.once(), requestTo(MARTA_URL))
                .andRespond(withStatus(HttpStatus.BAD_GATEWAY));
        mockServer.expect(ExpectedCount.once(), requestTo(MARTA_URL))
                .andRespond(withStatus(HttpStatus.GATEWAY_TIMEOUT));

        List<MartaTrain> trains = martaService.getLiveTrains();

        assertThat(trains).isEmpty();
    }

    @Test
    void getLiveTrainsDoesNotRetryNonRetriableClientErrors() {
        mockServer.expect(ExpectedCount.once(), requestTo(MARTA_URL))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withStatus(HttpStatus.UNAUTHORIZED));

        List<MartaTrain> trains = martaService.getLiveTrains();

        assertThat(trains).isEmpty();
    }

    private String singleTrainJson() {
        return """
                [
                  {
                    "DESTINATION": "Airport",
                    "LINE": "RED",
                    "STATION": "Midtown",
                    "WAITING_TIME": "5 min",
                    "WAITING_SECONDS": "300",
                    "IS_REALTIME": "true",
                    "DELAY": "0",
                    "TRAIN_ID": "101",
                    "LATITUDE": 33.7816,
                    "LONGITUDE": -84.3867,
                    "DIRECTION": "S"
                  }
                ]
                """;
    }
}


