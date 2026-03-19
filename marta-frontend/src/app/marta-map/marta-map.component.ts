import { Component, OnInit, OnDestroy } from '@angular/core';
import * as L from 'leaflet';
import { MartaService } from '../marta.service';
import { Subscription, timer } from 'rxjs';

@Component({
  selector: 'app-marta-map',
  template: '<div id="map" style="height: 600px; width: 100%;"></div>',
  styleUrls: ['./marta-map.component.css']
})
export class MartaMapComponent implements OnInit, OnDestroy {
  private map!: L.Map;
  private markers: L.Marker[] = [];
  private refreshSubscription!: Subscription;

  constructor(private martaService: MartaService) {}

  ngOnInit() {
    this.initMap();

    // Start the "Heartbeat": Fetch data every 10 seconds
    this.refreshSubscription = timer(0, 10000).subscribe(() => {
      this.updateTrainMarkers();
    });
  }

  private initMap(): void {
    // 1. Center slightly North of Five Points to capture the whole grid
    // 2. Set Zoom to 11 (this shows the whole 'H' of the MARTA rail)
    this.map = L.map('map', {
      zoomControl: true,
      dragging: true
    }).setView([33.76, -84.39], 11);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 16,
      minZoom: 10, // Prevents the user from zooming out to see the whole world
      attribution: '© OpenStreetMap'
    }).addTo(this.map);

    // 3. Optional: Add a 'Boundary' so they can't pan to Alabama
    const atlantaBounds = L.latLngBounds(
      L.latLng(33.4, -84.7), // Southwest corner
      L.latLng(34.1, -84.1)  // Northeast corner
    );
    this.map.setMaxBounds(atlantaBounds);
  }

  private updateTrainMarkers(): void {
      this.martaService.getTrains().subscribe({
        next: (trains) => {
          // 1. Clear existing markers from the map so we don't stack them
          this.markers.forEach(m => this.map.removeLayer(m));
          this.markers = [];

          // 2. Loop through the trains from your Java API
          trains.forEach(t => {
            // CRITICAL: We use t.LATITUDE (uppercase) to match your Java @JsonProperty
            if (t.LATITUDE && t.LONGITUDE) {

              // Create the marker at the train's GPS coordinates
              const m = L.marker([t.LATITUDE, t.LONGITUDE])
                .bindPopup(`
                  <div style="line-height: 1.5;">
                    <strong style="color: ${this.getLineColor(t.LINE)}; font-size: 1.1em;">
                      ${t.LINE} Line Train
                    </strong><br>
                    <b>To:</b> ${t.DESTINATION}<br>
                    <b>Next Station:</b> ${t.STATION}<br>
                    <b>Waiting:</b> ${t.WAITING_TIME}
                  </div>
                `)
                .addTo(this.map);

              this.markers.push(m);
            }
          });
          console.log(`Updated ${this.markers.length} trains on the map.`);
        },
        error: (err) => {
          console.error("Could not fetch trains. Is Spring Boot running?", err);
        }
      });
    }

    // Add this helper method below updateTrainMarkers to handle the colors
    private getLineColor(line: string): string {
      if (!line) return '#333';
      switch(line.toUpperCase()) {
        case 'RED': return '#ed1c24';
        case 'GOLD': return '#f2a900';
        case 'BLUE': return '#005596';
        case 'GREEN': return '#00843d';
        default: return '#333';
      }
    }

  ngOnDestroy() {
    // Crucial: Stop the timer if the user closes the app
    if (this.refreshSubscription) {
      this.refreshSubscription.unsubscribe();
    }
  }
}
