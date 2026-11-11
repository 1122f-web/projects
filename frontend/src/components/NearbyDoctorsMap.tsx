import { useEffect, useState } from 'react';
import { APIProvider, Map, AdvancedMarker, Pin } from '@vis.gl/react-google-maps';
import { api, errorMessage } from '../lib/api';
import { MapPin, Star } from 'lucide-react';

interface DoctorLocation {
  id: string;
  title: string | null;
  clinic_name: string | null;
  clinic_address: string | null;
  city: string | null;
  latitude: number;
  longitude: number;
  rating_avg: number;
  distance_km: number;
}

export function NearbyDoctorsMap() {
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [doctors, setDoctors] = useState<DoctorLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 1. Get Patient's Current GPS Location from browser
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          setUserLocation({ lat, lng });

          // 2. Fetch nearby doctors from backend
          try {
            const data = await api.get<DoctorLocation[]>(`/doctor/nearby?lat=${lat}&lng=${lng}&radius=30`);
            setDoctors(data);
          } catch (err: unknown) {
            setError(errorMessage(err));
          } finally {
            setLoading(false);
          }
        },
        () => {
          setError('Location access denied. Please enable location services to find nearby doctors.');
          setLoading(false);
        }
      );
    } else {
      setError('Geolocation is not supported by your browser.');
      setLoading(false);
    }
  }, []);

  const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || 'YOUR_GOOGLE_MAPS_API_KEY';

  if (loading) return <div className="p-6 text-center text-slate-500">Locating you and finding nearby doctors...</div>;
  if (error) return <div className="p-6 text-center text-red-600 bg-red-50 rounded-lg">{error}</div>;

  return (
    <div className="space-y-4">
      <div className="h-[450px] w-full rounded-xl overflow-hidden shadow-md border border-slate-200">
        <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
          <Map defaultCenter={userLocation ?? { lat: -0.5312, lng: 37.4579 }} defaultZoom={11}>
            {/* Patient Marker */}
            {userLocation && (
              <AdvancedMarker position={userLocation} title="Your Location">
                <Pin background={'#2563eb'} glyphColor={'#ffffff'} borderColor={'#1d4ed8'} />
              </AdvancedMarker>
            )}

            {/* Doctor Markers */}
            {doctors.map((doc) => (
              <AdvancedMarker
                key={doc.id}
                position={{ lat: doc.latitude, lng: doc.longitude }}
                title={doc.title ?? 'Doctor'}
              >
                <Pin background={'#0d9488'} glyphColor={'#ffffff'} borderColor={'#0f766e'} />
              </AdvancedMarker>
            ))}
          </Map>
        </APIProvider>
      </div>

      {/* List of Nearby Doctors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {doctors.map((doc) => (
          <div key={doc.id} className="p-4 bg-white rounded-lg border border-slate-200 shadow-sm flex justify-between items-start">
            <div>
              <h4 className="font-semibold text-slate-900">{doc.title ?? 'Doctor'}</h4>
              <p className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                <MapPin className="h-3.5 w-3.5 text-teal-600" /> {doc.clinic_address || doc.clinic_name || doc.city || 'Clinic location'}
              </p>
              <p className="text-xs font-medium text-teal-700 mt-2">
                📍 {doc.distance_km.toFixed(1)} km away from you
              </p>
            </div>
            <div className="text-right">
              <span className="inline-flex items-center gap-1 text-xs font-semibold bg-amber-50 text-amber-700 px-2 py-1 rounded">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {Number(doc.rating_avg || 0).toFixed(1)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}