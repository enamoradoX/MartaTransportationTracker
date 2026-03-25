import { Component, OnInit, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import * as L from 'leaflet';
import { MartaService } from '../marta.service';
import { Subscription, timer } from 'rxjs';

interface RailSegment {
  id: number;
  line: string;
  aLat: number;
  aLng: number;
  bLat: number;
  bLng: number;
  forwardBearing: number;
}

interface RailMatch {
  segmentId: number;
  lat: number;
  lng: number;
  distanceMeters: number;
  segmentBearing: number;
}

@Component({
  selector: 'app-marta-map',
  templateUrl: './marta-map.component.html',
  styleUrls: ['./marta-map.component.css']
})
export class MartaMapComponent implements OnInit, OnDestroy {
  private map!: L.Map;
  private markers: L.Marker[] = [];
  private refreshSubscription!: Subscription;
  private railCasingLayer?: L.GeoJSON;
  private railColorLayer?: L.GeoJSON;
  private readonly DEFAULT_HEADING_DEG = 45;
  private readonly MAX_TURN_PER_TICK_DEG = 24;
  private readonly TRACK_MATCH_MAX_DISTANCE_METERS = 160;
  private readonly TRACK_SWITCH_PENALTY_METERS = 18;
  private readonly trainPoseById = new Map<string, { lat: number; lng: number; heading: number }>();
  private readonly previousSegmentByTrainId = new Map<string, number>();
  private railSegments: RailSegment[] = [];

  readonly lineLegend = [
    { name: 'Red', color: '#ed1c24' },
    { name: 'Gold', color: '#f2a900' },
    { name: 'Blue', color: '#005596' },
    { name: 'Green', color: '#00843d' }
  ];

  private readonly lineColorByName: Record<string, string> = {
    RED: '#ed1c24',
    GOLD: '#f2a900',
    BLUE: '#005596',
    GREEN: '#00843d'
  };

  constructor(private martaService: MartaService, private http: HttpClient) {}

  ngOnInit() {
    this.initMap();
    this.initRailPane();
    this.loadRailLines();
    this.map.on('zoomend', this.refreshRailLineStyling, this);

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

  private initRailPane(): void {
    if (!this.map.getPane('railPane')) {
      this.map.createPane('railPane');
    }

    const railPane = this.map.getPane('railPane');
    if (railPane) {
      railPane.style.zIndex = '350'; // Keep rails above tiles and below markers.
    }
  }

  private loadRailLines(): void {
    this.http.get<any>('assets/marta-rail-lines.geojson').subscribe({
      next: (geojson) => this.drawRailLines(this.normalizeRailGeoJson(geojson)),
      error: (err) => console.error('Could not load MARTA rail GeoJSON', err)
    });
  }

  private normalizeRailGeoJson(rawGeoJson: any): any {
    if (!rawGeoJson || !Array.isArray(rawGeoJson.features)) {
      return rawGeoJson;
    }

    const normalizedFeatures = rawGeoJson.features
      .filter((feature: any) => {
        const geometryType = feature?.geometry?.type;
        return geometryType === 'LineString' || geometryType === 'MultiLineString';
      })
      .map((feature: any) => {
        const geometry = feature.geometry;

        if (geometry.type === 'LineString') {
          return {
            ...feature,
            geometry: {
              ...geometry,
              coordinates: this.normalizeCoordinateArray(geometry.coordinates)
            }
          };
        }

        return {
          ...feature,
          geometry: {
            ...geometry,
            coordinates: (geometry.coordinates || []).map((line: any[]) => this.normalizeCoordinateArray(line))
          }
        };
      });

    return {
      ...rawGeoJson,
      features: normalizedFeatures
    };
  }

  private normalizeCoordinateArray(coordinates: any[]): any[] {
    if (!Array.isArray(coordinates)) {
      return [];
    }

    return coordinates
      .filter((pair: any) => Array.isArray(pair) && pair.length >= 2)
      .map((pair: any[]) => this.normalizeCoordinatePair(pair))
      .filter((pair: number[] | null): pair is number[] => pair !== null);
  }

  private normalizeCoordinatePair(pair: any[]): number[] | null {
    const first = Number(pair[0]);
    const second = Number(pair[1]);

    if (!Number.isFinite(first) || !Number.isFinite(second)) {
      return null;
    }

    // GeoJSON expects [lon, lat]. Swap only when the order is obviously reversed.
    if (Math.abs(first) <= 90 && Math.abs(second) > 90) {
      return [second, first];
    }

    // MARTA data should be around Atlanta; this catches common [lat, lon] ordering mistakes.
    const isAtlantaLatLngOrder = first >= 32 && first <= 35 && second >= -86 && second <= -83;
    const isAtlantaLonLatOrder = first >= -86 && first <= -83 && second >= 32 && second <= 35;

    if (isAtlantaLatLngOrder && !isAtlantaLonLatOrder) {
      return [second, first];
    }

    return [first, second];
  }

  private drawRailLines(geojson: any): void {
    if (!this.map || !geojson) {
      return;
    }

    if (this.railCasingLayer) {
      this.map.removeLayer(this.railCasingLayer);
    }
    if (this.railColorLayer) {
      this.map.removeLayer(this.railColorLayer);
    }

    this.railCasingLayer = L.geoJSON(geojson, {
      pane: 'railPane',
      onEachFeature: (_feature: any, layer: L.Layer) => this.applyRailLinePrecision(layer),
      style: {
        color: '#1f2937',
        weight: this.getCasingWeightForZoom(),
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round'
      }
    }).addTo(this.map);

    this.railColorLayer = L.geoJSON(geojson, {
      pane: 'railPane',
      onEachFeature: (_feature: any, layer: L.Layer) => this.applyRailLinePrecision(layer),
      style: (feature: any) => {
        const line = (feature?.properties?.line || '').toUpperCase();
        return {
          color: this.lineColorByName[line] || '#64748b',
          weight: this.getColorWeightForZoom(),
          opacity: 0.98,
          lineCap: 'round',
          lineJoin: 'round'
        };
      }
    }).addTo(this.map);

    this.rebuildRailSegmentIndex(geojson);
    this.refreshRailLineStyling();
  }

  private refreshRailLineStyling(): void {
    if (!this.map) {
      return;
    }

    const casingWeight = this.getCasingWeightForZoom();
    const colorWeight = this.getColorWeightForZoom();

    if (this.railCasingLayer) {
      this.railCasingLayer.setStyle({ weight: casingWeight });
    }

    if (this.railColorLayer) {
      this.railColorLayer.setStyle({ weight: colorWeight });
    }
  }

  private getCasingWeightForZoom(): number {
    const zoom = this.map?.getZoom() ?? 11;
    if (zoom >= 15) {
      return 6;
    }

    if (zoom >= 13) {
      return 8;
    }

    return 10;
  }

  private getColorWeightForZoom(): number {
    const zoom = this.map?.getZoom() ?? 11;
    if (zoom >= 15) {
      return 3;
    }

    if (zoom >= 13) {
      return 5;
    }

    return 6;
  }

  private applyRailLinePrecision(layer: L.Layer): void {
    if (!(layer instanceof L.Polyline)) {
      return;
    }

    Object.assign(layer.options, this.getRailLinePrecisionOptions());
  }

  private getRailLinePrecisionOptions(): L.PolylineOptions {
    return {
      smoothFactor: 0,
      noClip: true
    };
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
              const pose = this.calculateTrainPose(trainId, lat, lng, t.DIRECTION);

              // Create the marker at the train's GPS coordinates
              const m = L.marker([pose.lat, pose.lng], {
                icon: this.createTrainIcon(t.LINE, pose.heading)
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
              this.previousSegmentByTrainId.delete(id);
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

    private calculateTrainPose(trainId: string, lat: number, lng: number, directionHint?: string): { lat: number; lng: number; heading: number } {
      const previous = this.trainPoseById.get(trainId);
      const previousHeading = previous?.heading ?? this.DEFAULT_HEADING_DEG;
      const mappedDirection = this.getHeadingFromDirection(directionHint);
      const movementHeading = this.getMovementHeading(previous, lat, lng);

      const railMatch = this.getNearestRailMatch(trainId, lat, lng);
      const displayLat = railMatch?.lat ?? lat;
      const displayLng = railMatch?.lng ?? lng;

      let targetHeading = previousHeading;

      if (railMatch) {
        targetHeading = this.chooseTrackAlignedHeading(
          railMatch.segmentBearing,
          movementHeading,
          mappedDirection,
          previousHeading
        );
        this.previousSegmentByTrainId.set(trainId, railMatch.segmentId);
      } else {
        this.previousSegmentByTrainId.delete(trainId);
        if (mappedDirection !== null && movementHeading !== null) {
          targetHeading = this.blendAngles(mappedDirection, movementHeading, 0.4);
        } else if (mappedDirection !== null) {
          targetHeading = mappedDirection;
        } else if (movementHeading !== null) {
          targetHeading = movementHeading;
        }
      }

      const smoothed = this.moveHeadingToward(previousHeading, targetHeading, this.MAX_TURN_PER_TICK_DEG);
      this.trainPoseById.set(trainId, { lat: displayLat, lng: displayLng, heading: smoothed });

      return { lat: displayLat, lng: displayLng, heading: smoothed };
    }

    private rebuildRailSegmentIndex(geojson: any): void {
      this.railSegments = [];
      if (!geojson || !Array.isArray(geojson.features)) {
        return;
      }

      let nextId = 1;
      geojson.features.forEach((feature: any) => {
        const line = (feature?.properties?.line || '').toString().toUpperCase();
        const geometry = feature?.geometry;
        const allLines: any[] = geometry?.type === 'LineString'
          ? [geometry.coordinates]
          : geometry?.type === 'MultiLineString'
            ? geometry.coordinates
            : [];

        allLines.forEach((lineCoords: any[]) => {
          const coords = this.normalizeCoordinateArray(lineCoords);
          for (let i = 1; i < coords.length; i += 1) {
            const [aLng, aLat] = coords[i - 1];
            const [bLng, bLat] = coords[i];
            const segmentBearing = this.getBearingDegrees(aLat, aLng, bLat, bLng);
            if (segmentBearing === null) {
              continue;
            }

            this.railSegments.push({
              id: nextId,
              line,
              aLat,
              aLng,
              bLat,
              bLng,
              forwardBearing: segmentBearing
            });
            nextId += 1;
          }
        });
      });
    }

    private getNearestRailMatch(trainId: string, lat: number, lng: number): RailMatch | null {
      if (this.railSegments.length === 0) {
        return null;
      }

      const previousSegmentId = this.previousSegmentByTrainId.get(trainId);
      let best: RailMatch | null = null;
      let bestScore = Number.POSITIVE_INFINITY;

      for (const segment of this.railSegments) {
        const projection = this.projectPointToSegment(lat, lng, segment);
        if (!projection) {
          continue;
        }

        const continuityPenalty = previousSegmentId !== undefined && previousSegmentId !== segment.id
          ? this.TRACK_SWITCH_PENALTY_METERS
          : 0;
        const score = projection.distanceMeters + continuityPenalty;

        if (score < bestScore) {
          bestScore = score;
          best = {
            segmentId: segment.id,
            lat: projection.lat,
            lng: projection.lng,
            distanceMeters: projection.distanceMeters,
            segmentBearing: segment.forwardBearing
          };
        }
      }

      if (!best || best.distanceMeters > this.TRACK_MATCH_MAX_DISTANCE_METERS) {
        return null;
      }

      return best;
    }

    private projectPointToSegment(lat: number, lng: number, segment: RailSegment): { lat: number; lng: number; distanceMeters: number } | null {
      const refLat = lat;
      const refLng = lng;
      const metersPerLat = 110540;
      const metersPerLng = 111320 * Math.cos(refLat * Math.PI / 180);
      if (Math.abs(metersPerLng) < 1e-6) {
        return null;
      }

      const ax = (segment.aLng - refLng) * metersPerLng;
      const ay = (segment.aLat - refLat) * metersPerLat;
      const bx = (segment.bLng - refLng) * metersPerLng;
      const by = (segment.bLat - refLat) * metersPerLat;

      const abx = bx - ax;
      const aby = by - ay;
      const abLenSq = abx * abx + aby * aby;
      if (abLenSq < 1e-6) {
        return null;
      }

      const t = Math.max(0, Math.min(1, -((ax * abx) + (ay * aby)) / abLenSq));
      const px = ax + (abx * t);
      const py = ay + (aby * t);

      return {
        lat: refLat + (py / metersPerLat),
        lng: refLng + (px / metersPerLng),
        distanceMeters: Math.sqrt(px * px + py * py)
      };
    }

    private chooseTrackAlignedHeading(
      segmentBearing: number,
      movementHeading: number | null,
      mappedDirection: number | null,
      previousHeading: number
    ): number {
      const forward = segmentBearing;
      const reverse = this.normalizeAngle(segmentBearing + 180);

      const referenceHeading = movementHeading ?? mappedDirection ?? previousHeading;
      const forwardDelta = Math.abs(this.signedAngleDelta(forward, referenceHeading));
      const reverseDelta = Math.abs(this.signedAngleDelta(reverse, referenceHeading));

      return forwardDelta <= reverseDelta ? forward : reverse;
    }

    private getBearingDegrees(aLat: number, aLng: number, bLat: number, bLng: number): number | null {
      const dLat = bLat - aLat;
      const dLng = bLng - aLng;
      const lengthSq = dLat * dLat + dLng * dLng;
      if (lengthSq < 1e-12) {
        return null;
      }

      return this.normalizeAngle((Math.atan2(dLng, dLat) * 180 / Math.PI + 360) % 360);
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
    this.previousSegmentByTrainId.clear();
    if (this.map && this.railCasingLayer) {
      this.map.removeLayer(this.railCasingLayer);
    }
    if (this.map && this.railColorLayer) {
      this.map.removeLayer(this.railColorLayer);
    }
    if (this.map) {
      this.map.off('zoomend', this.refreshRailLineStyling, this);
    }
  }
}
