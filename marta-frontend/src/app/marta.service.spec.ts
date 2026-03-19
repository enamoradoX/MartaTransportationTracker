import { TestBed } from '@angular/core/testing';

import { MartaService } from './marta.service';

describe('MartaService', () => {
  let service: MartaService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MartaService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
