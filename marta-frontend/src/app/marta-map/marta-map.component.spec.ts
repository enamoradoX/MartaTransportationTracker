import { MartaMapComponent } from './marta-map.component';

describe('MartaMapComponent', () => {
  const component = new MartaMapComponent({} as any, {} as any);
  const componentAny = component as any;

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('normalizes coordinate pairs that are clearly lat/lng instead of lon/lat', () => {
    const normalized = componentAny.normalizeCoordinatePair([33.7539, -84.3915]);
    expect(normalized).toEqual([-84.3915, 33.7539]);
  });

  it('keeps valid lon/lat coordinate pairs unchanged', () => {
    const normalized = componentAny.normalizeCoordinatePair([-84.3915, 33.7539]);
    expect(normalized).toEqual([-84.3915, 33.7539]);
  });

  it('normalizes coordinates in line features', () => {
    const input = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { line: 'RED' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [33.7539, -84.3915],
              [33.7489, -84.3954]
            ]
          }
        }
      ]
    };

    const normalized = componentAny.normalizeRailGeoJson(input);
    expect(normalized.features[0].geometry.coordinates[0]).toEqual([-84.3915, 33.7539]);
    expect(normalized.features[0].geometry.coordinates[1]).toEqual([-84.3954, 33.7489]);
  });

  it('uses high-precision polyline options for rail layers', () => {
    const options = componentAny.getRailLinePrecisionOptions();
    expect(options.smoothFactor).toBe(0);
    expect(options.noClip).toBeTrue();
  });

  it('uses thinner rail stroke widths at higher zoom levels', () => {
    componentAny.map = { getZoom: () => 11 };
    expect(componentAny.getCasingWeightForZoom()).toBe(10);
    expect(componentAny.getColorWeightForZoom()).toBe(6);

    componentAny.map = { getZoom: () => 15 };
    expect(componentAny.getCasingWeightForZoom()).toBe(6);
    expect(componentAny.getColorWeightForZoom()).toBe(3);
  });

  it('snaps a train position to the closest rail segment point', () => {
    componentAny.railSegments = [
      {
        id: 1,
        line: 'RED',
        aLat: 33.75,
        aLng: -84.4,
        bLat: 33.75,
        bLng: -84.3,
        forwardBearing: 90
      }
    ];

    const match = componentAny.getNearestRailMatch('train-1', 33.7512, -84.35);
    expect(match).toBeTruthy();
    expect(match.lat).toBeCloseTo(33.75, 3);
    expect(match.lng).toBeCloseTo(-84.35, 3);
    expect(match.segmentBearing).toBe(90);
  });

  it('chooses the rail direction that matches train movement', () => {
    const forwardBearing = 90;

    const westbound = componentAny.chooseTrackAlignedHeading(forwardBearing, 270, null, 90);
    expect(westbound).toBe(270);

    const eastbound = componentAny.chooseTrackAlignedHeading(forwardBearing, 90, null, 270);
    expect(eastbound).toBe(90);
  });
});
