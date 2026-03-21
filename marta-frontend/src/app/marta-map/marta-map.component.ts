import { Component, OnInit, OnDestroy } from '@angular/core';
import * as L from 'leaflet';
import { MartaService } from '../marta.service';
import { Subscription, timer } from 'rxjs';

@Component({
  selector: 'app-marta-map',
  templateUrl: './marta-map.component.html',
  styleUrls: ['./marta-map.component.css']
})
export class MartaMapComponent implements OnInit, OnDestroy {
  private map!: L.Map;
  private markers: L.Marker[] = [];
  private refreshSubscription!: Subscription;
  private readonly DEFAULT_HEADING_DEG = 45;
  private readonly TRACK_SNAP_STEP_DEG = 45;
  private readonly SNAP_HYSTERESIS_DEG = 18;
  private readonly MAX_TURN_PER_TICK_DEG = 24;
  private readonly trainPoseById = new Map<string, { lat: number; lng: number; heading: number }>();

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
      zoomControl: false,
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

  zoomIn(): void {
    if (this.map) {
      this.map.zoomIn();
    }
  }

  zoomOut(): void {
    if (this.map) {
      this.map.zoomOut();
    }
  }

  private updateTrainMarkers(): void {
      this.martaService.getTrains().subscribe({
        next: (trains) => {
          const activeTrainIds = new Set<string>();

          // 1. Clear existing markers from the map so we don't stack them
          this.markers.forEach(m => this.map.removeLayer(m));
          this.markers = [];

          // 2. Loop through the trains from your Java API
          trains.forEach(t => {
            // CRITICAL: We use t.LATITUDE (uppercase) to match your Java @JsonProperty
            if (t.LATITUDE && t.LONGITUDE) {
              const trainId = this.getTrainEntityId(t);
              activeTrainIds.add(trainId);

              const lat = Number(t.LATITUDE);
              const lng = Number(t.LONGITUDE);
              const heading = this.calculateHeading(trainId, lat, lng, t.DIRECTION);

              // Create the marker at the train's GPS coordinates
              const m = L.marker([lat, lng], {
                icon: this.createTrainIcon(t.LINE, heading)
              })
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

          // Keep pose memory only for trains still present in the latest poll.
          Array.from(this.trainPoseById.keys()).forEach((id) => {
            if (!activeTrainIds.has(id)) {
              this.trainPoseById.delete(id);
            }
          });

          console.log(`Updated ${this.markers.length} trains on the map.`);
        },
        error: (err) => {
          console.error("Could not fetch trains. Is Spring Boot running?", err);
        }
      });
    }

    private createTrainIcon(line: string, headingDeg: number): L.DivIcon {
      const lineClass = this.getLineClass(line);
      return L.divIcon({
        className: 'marta-train-icon-wrapper',
        html: `
          <div class="marta-train-heading" style="transform: rotate(${headingDeg.toFixed(1)}deg);">
            <div class="marta-train-iso ${lineClass}">
              <div class="marta-train-iso-roof"></div>
              <div class="marta-train-iso-body">
                <span class="marta-train-window"></span>
                <span class="marta-train-window"></span>
                <span class="marta-train-window"></span>
              </div>
              <div class="marta-train-cab"></div>
              <div class="marta-train-nose"></div>
              <div class="marta-train-iso-side"></div>
              <div class="marta-train-wheel wheel-a"></div>
              <div class="marta-train-wheel wheel-b"></div>
            </div>
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -14]
      });
    }

    private calculateHeading(trainId: string, lat: number, lng: number, directionHint?: string): number {
      const previous = this.trainPoseById.get(trainId);
      const previousHeading = previous?.heading ?? this.DEFAULT_HEADING_DEG;

      const mappedDirection = this.getHeadingFromDirection(directionHint);
      const movementHeading = this.getMovementHeading(previous, lat, lng);

      let targetHeading = previousHeading;

      if (mappedDirection !== null && movementHeading !== null) {
        // Blend real movement with API direction so icons stay rail-aligned but do not jump.
        targetHeading = this.blendAngles(mappedDirection, movementHeading, 0.4);
      } else if (mappedDirection !== null) {
        targetHeading = mappedDirection;
      } else if (movementHeading !== null) {
        targetHeading = movementHeading;
      }

      const snapped = this.snapHeadingToTrackAxisWithHysteresis(targetHeading, previousHeading);
      const smoothed = this.moveHeadingToward(previousHeading, snapped, this.MAX_TURN_PER_TICK_DEG);

      this.trainPoseById.set(trainId, { lat, lng, heading: smoothed });
      return smoothed;
    }

    private getMovementHeading(previous: { lat: number; lng: number; heading: number } | undefined, lat: number, lng: number): number | null {
      if (!previous) {
        return null;
      }

      const dLat = lat - previous.lat;
      const dLng = lng - previous.lng;
      const distanceSq = dLat * dLat + dLng * dLng;

      if (distanceSq < 1e-10) {
        return null;
      }

      return this.normalizeAngle((Math.atan2(dLng, dLat) * 180 / Math.PI + 360) % 360);
    }

    private getHeadingFromDirection(directionHint?: string): number | null {
      if (!directionHint) {
        return null;
      }

      const d = directionHint.toString().trim().toUpperCase();
      const map: { [key: string]: number } = {
        N: 0,
        NORTH: 0,
        NORTHBOUND: 0,
        E: 90,
        EAST: 90,
        EASTBOUND: 90,
        S: 180,
        SOUTH: 180,
        SOUTHBOUND: 180,
        W: 270,
        WEST: 270,
        WESTBOUND: 270,
        NE: 45,
        NORTHEAST: 45,
        NORTHEASTBOUND: 45,
        SE: 135,
        SOUTHEAST: 135,
        SOUTHEASTBOUND: 135,
        SW: 225,
        SOUTHWEST: 225,
        SOUTHWESTBOUND: 225,
        NW: 315,
        NORTHWEST: 315,
        NORTHWESTBOUND: 315
      };

      return Object.prototype.hasOwnProperty.call(map, d) ? map[d] : null;
    }

    private snapHeadingToTrackAxis(headingDeg: number): number {
      return this.normalizeAngle(Math.round(headingDeg / this.TRACK_SNAP_STEP_DEG) * this.TRACK_SNAP_STEP_DEG);
    }

    private snapHeadingToTrackAxisWithHysteresis(targetHeading: number, previousHeading: number): number {
      const snappedTarget = this.snapHeadingToTrackAxis(targetHeading);
      const snappedPrevious = this.snapHeadingToTrackAxis(previousHeading);

      if (snappedTarget !== snappedPrevious) {
        const deltaToPreviousAxis = Math.abs(this.signedAngleDelta(targetHeading, snappedPrevious));
        if (deltaToPreviousAxis < this.SNAP_HYSTERESIS_DEG) {
          return snappedPrevious;
        }
      }

      return snappedTarget;
    }

    private blendAngles(aDeg: number, bDeg: number, bWeight: number): number {
      const delta = this.signedAngleDelta(bDeg, aDeg);
      return this.normalizeAngle(aDeg + delta * bWeight);
    }

    private moveHeadingToward(currentDeg: number, targetDeg: number, maxStepDeg: number): number {
      const delta = this.signedAngleDelta(targetDeg, currentDeg);
      const step = Math.max(-maxStepDeg, Math.min(maxStepDeg, delta));
      return this.normalizeAngle(currentDeg + step);
    }

    private signedAngleDelta(targetDeg: number, baseDeg: number): number {
      return ((targetDeg - baseDeg + 540) % 360) - 180;
    }

    private normalizeAngle(angleDeg: number): number {
      return ((angleDeg % 360) + 360) % 360;
    }

    private getTrainEntityId(train: any): string {
      const trainId = (train.TRAIN_ID || train.TRAINID || '').toString().trim();
      if (trainId) {
        return trainId;
      }

      const line = (train.LINE || '').toString();
      const destination = (train.DESTINATION || '').toString();
      const direction = (train.DIRECTION || '').toString();
      return `${line}|${destination}|${direction}`;
    }

    private getLineClass(line: string): string {
      if (!line) return 'line-default';
      switch(line.toUpperCase()) {
        case 'RED': return 'line-red';
        case 'GOLD': return 'line-gold';
        case 'BLUE': return 'line-blue';
        case 'GREEN': return 'line-green';
        default: return 'line-default';
      }
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
