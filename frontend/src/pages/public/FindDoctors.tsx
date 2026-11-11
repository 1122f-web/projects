import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { LayoutGrid, Map as MapIcon, SearchX, SlidersHorizontal, Navigation } from 'lucide-react';
import { api, qs } from '../../lib/api';
import type { DoctorSummary, Paged } from '../../lib/types';
import { usePublicSettings, useSpecialties } from '../../hooks/useSettings';
import { DoctorCard } from '../../components/doctors/DoctorCard';
import { Input, Select } from '../../components/ui/Field';
import { Button } from '../../components/ui/Button';
import { EmptyState, ErrorState, Spinner } from '../../components/ui/Feedback';
import { Pagination } from '../../components/ui/Misc';
import CentralMapDirections from './CentralGoogleMapDirections';

const LIMIT = 12;

// Haversine formula to calculate distance between patient and doctor
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const rawA =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const a = Math.min(1, Math.max(0, rawA));
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function FindDoctorsPage({ basePath = '/doctors', embedded = false }: { basePath?: string; embedded?: boolean }) {
  const [params, setParams] = useSearchParams();
  const specialties = useSpecialties();
  const { currency } = usePublicSettings();
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'map'>('map');
  const [q, setQ] = useState(params.get('q') ?? '');
  
  const [patientLocation, setPatientLocation] = useState<google.maps.LatLngLiteral | null>(null);
  const [locating, setLocating] = useState(false);
  const [sortByProximity, setSortByProximity] = useState(false);
  const [radiusKm, setRadiusKm] = useState('25');
  const [locationError, setLocationError] = useState<string | null>(null);

  useEffect(() => setQ(params.get('q') ?? ''), [params]);

  // Request patient's browser location
  const handleGetLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser.');
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPatientLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setSortByProximity(true);
        setLocating(false);
      },
      (error) => {
        console.error('Error getting location:', error);
        setLocationError('Unable to retrieve your location. Please check browser permissions and try again.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  const filters = {
    q: params.get('q') ?? undefined,
    specialty: params.get('specialty') ?? undefined,
    min_fee: params.get('min_fee') ?? undefined,
    max_fee: params.get('max_fee') ?? undefined,
    available_on: params.get('available_on') ?? undefined,
    type: params.get('type') ?? undefined,
    sort: params.get('sort') ?? 'rating',
    offset: Number(params.get('offset') ?? 0),
  };

  const nearbyFilters = patientLocation && sortByProximity
    ? { lat: patientLocation.lat, lng: patientLocation.lng, radius_km: Number(radiusKm) }
    : {};
  const requestFilters = {
    ...filters,
    ...nearbyFilters,
    sort: nearbyFilters.lat !== undefined ? 'distance' : filters.sort,
  };

  const query = useQuery({
    queryKey: ['doctors', requestFilters],
    queryFn: () => api.get<Paged<DoctorSummary>>(`/doctors${qs({ ...requestFilters, limit: LIMIT })}`),
    placeholderData: keepPreviousData,
  });

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('offset' in patch)) next.delete('offset');
    setParams(next, { replace: true });
  };

  // Calculate distances if patient location is available
  const processedDoctors = (query.data?.items ?? [])
    .map((doc) => ({
      ...doc,
      distance: patientLocation
        ? doc.distance_km != null && Number.isFinite(doc.distance_km)
          ? doc.distance_km
          : doc.latitude != null &&
              doc.longitude != null &&
              Number.isFinite(doc.latitude) &&
              Number.isFinite(doc.longitude)
            ? calculateDistance(
              patientLocation.lat,
              patientLocation.lng,
              doc.latitude,
              doc.longitude,
            )
            : undefined
        : undefined,
    }))
    .sort((a, b) =>
      sortByProximity && patientLocation
        ? (a.distance ?? Infinity) - (b.distance ?? Infinity)
        : 0,
    );

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className={embedded ? '' : 'mx-auto max-w-7xl px-4 py-10 sm:px-6'}>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Find a doctor</h1>
          <p className="mt-1 text-slate-600">Search verified doctors, view clinic locations, and get directions.</p>
        </div>
        
        <div className="flex items-center gap-3 flex-wrap">
          <Button 
            variant={patientLocation ? 'primary' : 'outline'} 
            size="sm" 
            onClick={handleGetLocation}
            disabled={locating}
            className="flex items-center gap-1.5 text-xs"
          >
            <Navigation className="h-4 w-4" />
            {locating ? 'Locating...' : patientLocation ? 'Location Active' : 'Use My Location'}
          </Button>

          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
            <Button
              variant={viewMode === 'grid' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('grid')}
              className="flex items-center gap-1.5 text-xs"
            >
              <LayoutGrid className="h-4 w-4" /> Cards
            </Button>
            <Button
              variant={viewMode === 'map' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('map')}
              className="flex items-center gap-1.5 text-xs"
            >
              <MapIcon className="h-4 w-4" /> Map
            </Button>
          </div>
        </div>
      </div>

      {locationError && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {locationError}
        </p>
      )}

      <form
        role="search"
        className="mb-4 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: q.trim() || undefined });
        }}
      >
        <div className="flex-1">
          <Input label="Search" hideLabel placeholder="Search by name, specialty, clinic or city" value={q} onChange={(e) => setQ(e.target.value)} maxLength={100} />
        </div>
        <div className="flex gap-2">
          <Button type="submit">Search</Button>
          <Button variant="outline" className="lg:hidden" aria-expanded={showFilters} aria-controls="doctor-filters" onClick={() => setShowFilters((s) => !s)}>
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Filters
          </Button>
        </div>
      </form>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        <aside id="doctor-filters" className={`${showFilters ? 'block' : 'hidden'} space-y-4 rounded-xl border border-slate-200 bg-white p-4 lg:block`} aria-label="Filters">
          <Select label="Specialty" value={filters.specialty ?? ''} onChange={(e) => update({ specialty: e.target.value || undefined })}>
            <option value="">All specialties</option>
            {specialties.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Input
            label="Available on"
            type="date"
            min={today}
            value={filters.available_on ?? ''}
            onChange={(e) => update({ available_on: e.target.value || undefined })}
          />
          <Select label="Consultation type" value={filters.type ?? ''} onChange={(e) => update({ type: e.target.value || undefined })}>
            <option value="">Any</option>
            <option value="online">Online</option>
            <option value="in_person">In person</option>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Input
              label={`Min fee (${currency})`}
              type="number"
              min={0}
              inputMode="numeric"
              value={filters.min_fee ?? ''}
              onChange={(e) => update({ min_fee: e.target.value || undefined })}
            />
            <Input
              label={`Max fee (${currency})`}
              type="number"
              min={0}
              inputMode="numeric"
              value={filters.max_fee ?? ''}
              onChange={(e) => update({ max_fee: e.target.value || undefined })}
            />
          </div>
          <Select label="Sort by" value={filters.sort} onChange={(e) => update({ sort: e.target.value })}>
            <option value="rating">Highest rated</option>
            <option value="fee_asc">Lowest fee</option>
            <option value="fee_desc">Highest fee</option>
            <option value="experience">Most experienced</option>
            <option value="name">Name (A to Z)</option>
          </Select>

          <div className="border-t border-slate-100 pt-2">
            <label className={`flex items-center gap-2 text-sm font-medium ${patientLocation ? 'cursor-pointer text-slate-700' : 'text-slate-400'}`}>
              <input
                type="checkbox"
                checked={sortByProximity}
                disabled={!patientLocation}
                onChange={(e) => setSortByProximity(e.target.checked)}
                className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
              />
              Show nearby clinics, nearest first
            </label>
            {!patientLocation && <p className="mt-1 text-xs text-slate-400">Share your location to enable distance sorting.</p>}
            <Select
              label="Clinic radius"
              value={radiusKm}
              disabled={!patientLocation}
              onChange={(e) => setRadiusKm(e.target.value)}
            >
              <option value="5">Within 5 km</option>
              <option value="10">Within 10 km</option>
              <option value="25">Within 25 km</option>
              <option value="50">Within 50 km</option>
              <option value="100">Within 100 km</option>
            </Select>
          </div>

          <Button variant="ghost" className="w-full" onClick={() => { setParams(new URLSearchParams(), { replace: true }); setSortByProximity(false); }}>
            Clear filters
          </Button>
        </aside>

        <section className="lg:col-span-3" aria-live="polite" aria-busy={query.isFetching}>
          {query.isLoading ? (
            <Spinner label="Finding doctors" />
          ) : query.isError ? (
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          ) : processedDoctors.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="No doctors match your search"
              description="Try another specialty or date, or clear the filters."
              action={<Button variant="outline" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear filters</Button>}
            />
          ) : (
            <>
              <p className="mb-3 text-sm text-slate-500">
                {processedDoctors.length} doctors found
                {patientLocation && sortByProximity && ` within ${radiusKm} km, nearest first`}
              </p>
              
              <div className="grid gap-6 lg:grid-cols-12">
                <div className={`${viewMode === 'map' ? 'hidden lg:block lg:col-span-6' : 'lg:col-span-12'} grid gap-4 sm:grid-cols-2 xl:grid-cols-3`}>
                  {processedDoctors.map((d) => {
                    // DYNAMIC LINK GENERATION FOR GOOGLE MAPS
                    const hasCoordinates = d.latitude != null && d.longitude != null;
                    const destinationParam = hasCoordinates
                      ? `${d.latitude},${d.longitude}` 
                      : encodeURIComponent(`${d.clinic_name || ''} ${d.clinic_address || ''} ${d.city || ''}`);
                    
                    const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${destinationParam}`;

                    return (
                      <div key={d.id} className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                        <DoctorCard doctor={d} currency={currency} basePath={basePath} />
                        
                        {/* NAVIGATION BUTTON SECTION */}
                        {(hasCoordinates || patientLocation) && (
                          <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500 flex flex-col gap-2">
                            {hasCoordinates && (
                              <span className="font-mono text-[11px] text-slate-400">
                                Coords: {Number(d.latitude).toFixed(4)}, {Number(d.longitude).toFixed(4)}
                              </span>
                            )}
                            {patientLocation && d.distance !== undefined ? (
                              <span className="font-semibold text-emerald-600">
                                📍 {d.distance.toFixed(1)} km away from you
                              </span>
                            ) : patientLocation ? (
                              <span>Distance unavailable</span>
                            ) : null}

                            {hasCoordinates && (
                              <a
                                href={googleMapsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-1 inline-flex items-center justify-center gap-1.5 w-full bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-medium py-2 px-3 rounded-lg transition-colors text-xs"
                              >
                                Open in Google Maps ↗
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className={`${viewMode === 'grid' ? 'hidden lg:block lg:col-span-6' : 'lg:col-span-12'} sticky top-4 h-[600px] overflow-hidden rounded-xl border border-slate-200 shadow-sm`}>
                  <CentralMapDirections patientLocation={patientLocation} doctors={processedDoctors} />
                </div>
              </div>

              <div className="mt-6">
                <Pagination total={query.data?.total ?? 0} limit={LIMIT} offset={filters.offset} onChange={(o) => update({ offset: String(o) })} />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}