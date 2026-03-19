import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http'; // 1. Import the client
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class MartaService {

  // 2. Define your Spring Boot URL (MartaController)
  private readonly API_URL = 'http://localhost:8080/api/trains';

  // 3. Inject the HttpClient in the constructor
  constructor(private http: HttpClient) { }

  /**
   * Fetches the live train list from your Java Backend.
   * Returns an Observable that the Component can "Subscribe" to.
   */
  getTrains(): Observable<any[]> {
    return this.http.get<any[]>(this.API_URL);
  }
}
