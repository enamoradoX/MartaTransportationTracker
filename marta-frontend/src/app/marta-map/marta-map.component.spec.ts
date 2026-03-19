import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MartaMapComponent } from './marta-map.component';

describe('MartaMapComponent', () => {
  let component: MartaMapComponent;
  let fixture: ComponentFixture<MartaMapComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ MartaMapComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MartaMapComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
