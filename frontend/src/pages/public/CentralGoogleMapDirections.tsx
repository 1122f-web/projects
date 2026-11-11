/// <reference types="google.maps" />
import { useState, useEffect } from 'react';
import { 
  APIProvider, 
  Map, 
  AdvancedMarker, 
  Pin, 
  useMap, 
  useMapsLibrary 
} from '@vis.gl/react-google-maps';

interface DirectionsRouteProps {
  origin: google.maps.LatLngLiteral;
  destination: google.maps.LatLngLiteral;
}

interface DoctorLocation {
  id?: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  full_name?: string;
  name?: string;
  clinic_name?: string | null;
  clinic_address?: string | null;
  distance?: number;
}

interface CentralMapDirectionsProps {
  patientLocation?: google.maps.LatLngLiteral | null;
  doctors?: DoctorLocation[];
  onSelectDoctor?: (doctor: DoctorLocation) => void;
}

function FitMapToLocations({
  patientLocation,
  doctors,
}: {
  patientLocation?: google.maps.LatLngLiteral | null;
  doctors: DoctorLocation[];
}) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    const locations = doctors.flatMap((doctor) => {
      if (doctor.latitude == null || doctor.longitude == null) return [];
      const lat = Number(doctor.latitude);
      const lng = Number(doctor.longitude);
      return Number.isFinite(lat) && Number.isFinite(lng) ? [{ lat, lng }] : [];
    });
    if (patientLocation) locations.push(patientLocation);
    if (locations.length === 0) return;

    const bounds = new google.maps.LatLngBounds();
    locations.forEach((location) => bounds.extend(location));
    if (locations.length === 1) {
      map.setCenter(locations[0]!);
      map.setZoom(12);
    } else {
      map.fitBounds(bounds, 48);
    }
  }, [doctors, map, patientLocation]);

  return null;
}

function DirectionsRoute({ origin, destination }: DirectionsRouteProps) {
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
    if (!directionsService || !directionsRenderer) return;
    if (!origin || !destination) return;

    directionsService.route(
      {
        origin: origin,
        destination: destination,
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === 'OK' && result) {
          directionsRenderer.setDirections(result);
        } else {
          console.error("Error fetching directions:", status);
        }
      }
    );
  }, [directionsService, directionsRenderer, origin, destination]);

  return null;
}

export default function CentralMapDirections({ patientLocation, doctors = [], onSelectDoctor }: CentralMapDirectionsProps) {
  const defaultCenter = patientLocation || { lat: -0.5312, lng: 37.4579 }; // Default to Embu / Central Kenya
  const [selectedDoctor, setSelectedDoctor] = useState<DoctorLocation | null>(null);
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const mapId = import.meta.env.VITE_GOOGLE_MAP_ID || 'DEMO_MAP_ID';
  const doctorsWithCoordinates = doctors.filter((doctor) => {
    const lat = Number(doctor.latitude);
    const lng = Number(doctor.longitude);
    return doctor.latitude != null && doctor.longitude != null && Number.isFinite(lat) && Number.isFinite(lng);
  }).length;

  if (!apiKey) {
    return (
      <div role="alert" className="grid h-full min-h-[500px] place-items-center bg-slate-50 p-6 text-center text-sm text-slate-600">
        Google Maps is unavailable because VITE_GOOGLE_MAPS_API_KEY is not configured.
      </div>
    );
  }

  return (
    <div style={{ height: "100%", width: "100%", minHeight: "500px", borderRadius: "12px", overflow: "hidden", position: "relative" }}>
      <APIProvider apiKey={apiKey}>
        <Map defaultCenter={defaultCenter} defaultZoom={10} mapId={mapId} style={{ width: '100%', height: '100%', minHeight: '500px' }}>
          <FitMapToLocations patientLocation={patientLocation} doctors={doctors} />
          {/* Patient Location Marker */}
          {patientLocation && (
            <AdvancedMarker position={patientLocation} title="Your Current Location">
              <Pin background={'#0284c7'} glyphColor={'#fff'} borderColor={'#0369a1'} />
            </AdvancedMarker>
          )}

          {/* Doctor / Clinic Markers */}
          {doctors.map((doc, index) => {
            if (doc.latitude == null || doc.longitude == null) return null;
            const lat = Number(doc.latitude);
            const lng = Number(doc.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
            const docPosition = { lat, lng };

            return (
              <AdvancedMarker 
                key={doc.id || index} 
                position={docPosition}
                title={doc.full_name || doc.name}
                onClick={() => {
                  setSelectedDoctor(doc);
                  if (onSelectDoctor) onSelectDoctor(doc);
                }}
              >
                <Pin background={'#16a34a'} glyphColor={'#fff'} borderColor={'#15803d'} />
              </AdvancedMarker>
            );
          })}

          {/* Render route inside web map if patient location and doctor pin are clicked */}
          {patientLocation && selectedDoctor && selectedDoctor.latitude != null && selectedDoctor.longitude != null && (
            <DirectionsRoute 
              origin={patientLocation} 
              destination={{ lat: Number(selectedDoctor.latitude), lng: Number(selectedDoctor.longitude) }} 
            />
          )}
        </Map>
      </APIProvider>

      {doctorsWithCoordinates === 0 && (
        <p className="absolute left-3 right-3 top-3 rounded-lg bg-white/95 p-3 text-center text-sm text-slate-600 shadow">
          No clinic locations are available on the map yet. Doctors need to add their clinic coordinates to appear here.
        </p>
      )}

      {/* Floating Info Card with Phone Navigation Link */}
      {selectedDoctor && (
        <div className="absolute bottom-4 left-4 right-4 z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
          <div>
            <h4 className="font-bold text-slate-800">{selectedDoctor.full_name || selectedDoctor.name}</h4>
            <p className="text-xs text-slate-500">{selectedDoctor.clinic_address || selectedDoctor.clinic_name || 'Clinic Location'}</p>
            {selectedDoctor.distance !== undefined && (
              <p className="mt-1 text-xs font-semibold text-emerald-600">
                📍 {selectedDoctor.distance.toFixed(1)} km away from you
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${selectedDoctor.latitude},${selectedDoctor.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 sm:flex-initial text-center text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-lg transition-colors"
            >
              Start GPS Navigation ↗
            </a>
            <button 
              onClick={() => setSelectedDoctor(null)}
              className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-2 rounded-lg"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}