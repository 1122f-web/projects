/// <reference types="google.maps" />
import { useState, useEffect } from 'react';
import { APIProvider, Map, AdvancedMarker, Pin, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';

interface DoctorLocation {
  id: string;
  full_name?: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  specialization?: string | null;
  hospital_name?: string | null;
}

interface DirectionsRouteProps {
  origin: google.maps.LatLngLiteral;
  destination: google.maps.LatLngLiteral;
  onRouteCalculated: (info: { distance: string; duration: string }) => void;
}

function DirectionsRoute({ origin, destination, onRouteCalculated }: DirectionsRouteProps) {
  const map = useMap();
  const routesLibrary = useMapsLibrary('routes');
  const [directionsService, setDirectionsService] = useState<google.maps.DirectionsService | null>(null);
  const [directionsRenderer, setDirectionsRenderer] = useState<google.maps.DirectionsRenderer | null>(null);

  useEffect(() => {
    if (!routesLibrary || !map) return;
    setDirectionsService(new routesLibrary.DirectionsService());
    setDirectionsRenderer(new routesLibrary.DirectionsRenderer({ map }));
  }, [routesLibrary, map]);

  useEffect(() => {
    if (!directionsService || !directionsRenderer || !origin || !destination) return;

    directionsService.route(
      {
        origin,
        destination,
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === 'OK' && result) {
          directionsRenderer.setDirections(result);
          const leg = result.routes[0]?.legs[0];
          if (!leg?.distance?.text || !leg.duration?.text) return;
          onRouteCalculated({ distance: leg.distance.text, duration: leg.duration.text });
        }
      }
    );
  }, [directionsService, directionsRenderer, origin, destination, onRouteCalculated]);

  return null;
}

export default function PatientDoctorFinder() {
  const [patientLocation, setPatientLocation] = useState({ lat: -0.5312, lng: 37.4579 });
  const [selectedDoctor, setSelectedDoctor] = useState<DoctorLocation | null>(null);
  const [routeInfo, setRouteInfo] = useState<{ distance: string; duration: string } | null>(null);
  const [doctors, setDoctors] = useState<DoctorLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  useEffect(() => {
    async function fetchNearbyDoctors() {
      try {
        const response = await fetch(
          `/api/doctor/profile?lat=${patientLocation.lat}&lng=${patientLocation.lng}`
        );
        const data = await response.json();
        setDoctors(data);
      } catch (err) {
        console.error("Failed to fetch doctors:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchNearbyDoctors();
  }, [patientLocation]);

  const handleUseMyLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        setPatientLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        });
      });
    }
  };

  return (
    <div style={{ display: 'flex', gap: '20px', height: 'calc(100vh - 80px)', padding: '20px', fontFamily: 'sans-serif' }}>
      <div style={{ width: '400px', display: 'flex', flexDirection: 'column', gap: '15px', overflowY: 'auto' }}>
        <h2>Find Nearby Doctors</h2>
        
        <button 
          onClick={handleUseMyLocation}
          style={{ padding: '10px', backgroundColor: '#0284c7', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
        >
          📍 Use Current Location
        </button>

        {routeInfo && selectedDoctor && (
          <div style={{ padding: '12px', backgroundColor: '#e0f2fe', borderRadius: '8px', borderLeft: '4px solid #0284c7' }}>
            <h4>Driving Route to {selectedDoctor.full_name}</h4>
            <p><strong>Distance:</strong> {routeInfo.distance}</p>
            <p><strong>Estimated Time:</strong> {routeInfo.duration}</p>
          </div>
        )}

        <h3>Available Doctors ({doctors.length})</h3>
        {loading ? <p>Loading doctors near you...</p> : doctors.map((doc, index) => (
          <div 
            key={doc.id || index} 
            onClick={() => {
              setSelectedDoctor(doc);
              setRouteInfo(null);
            }}
            style={{ 
              padding: '14px', 
              border: selectedDoctor?.id === doc.id ? '2px solid #16a34a' : '1px solid #ddd', 
              borderRadius: '8px',
              cursor: 'pointer',
              backgroundColor: selectedDoctor?.id === doc.id ? '#f0fdf4' : '#fff'
            }}
          >
            <h4 style={{ margin: '0 0 5px 0' }}>{doc.full_name || "Doctor Profile"}</h4>
            <p style={{ margin: '0 0 5px 0', color: '#666' }}>{doc.specialization || 'General Practitioner'}</p>
            <p style={{ margin: 0, fontSize: '13px', color: '#888' }}>📍 {doc.hospital_name || 'Central Kenya Clinic'}</p>
            
            <button 
              style={{ marginTop: '10px', width: '100%', padding: '8px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
            >
              Get Directions & Request
            </button>
          </div>
        ))}
      </div>

      <div style={{ flex: 1, minWidth: 0, minHeight: '400px', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
        {googleMapsApiKey ? (
          <APIProvider apiKey={googleMapsApiKey}>
            <Map
              style={{ width: '100%', height: '100%', minHeight: '400px' }}
              defaultCenter={patientLocation}
              defaultZoom={11}
              mapId={import.meta.env.VITE_GOOGLE_MAP_ID || 'DEMO_MAP_ID'}
            >
              <AdvancedMarker position={patientLocation} title="You Are Here">
                <Pin background="#0284c7" glyphColor="#fff" borderColor="#0369a1" />
              </AdvancedMarker>

              {doctors.map((doc, index) => {
                const lat = Number(doc.latitude);
                const lng = Number(doc.longitude);
                if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

                return (
                  <AdvancedMarker
                    key={doc.id || index}
                    position={{ lat, lng }}
                    onClick={() => {
                      setSelectedDoctor(doc);
                      setRouteInfo(null);
                    }}
                  >
                    <Pin background="#16a34a" glyphColor="#fff" borderColor="#15803d" />
                  </AdvancedMarker>
                );
              })}

              {selectedDoctor && selectedDoctor.latitude != null && selectedDoctor.longitude != null && (
                <DirectionsRoute
                  origin={patientLocation}
                  destination={{ lat: Number(selectedDoctor.latitude), lng: Number(selectedDoctor.longitude) }}
                  onRouteCalculated={setRouteInfo}
                />
              )}
            </Map>
          </APIProvider>
        ) : (
          <div role="alert" style={{ height: '100%', minHeight: '400px', display: 'grid', placeItems: 'center', padding: '24px', textAlign: 'center', color: '#b91c1c', background: '#fef2f2' }}>
            Google Maps is unavailable because VITE_GOOGLE_MAPS_API_KEY is not configured.
          </div>
        )}
      </div>
    </div>
  );
}