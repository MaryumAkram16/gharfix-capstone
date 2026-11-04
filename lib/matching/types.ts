// Shared types for khadmat-provider-match (WF2 matching + WF3 pricing).

export type Complexity = 'basic' | 'intermediate' | 'complex';
export type Level = 'low' | 'medium' | 'high';

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** What the matcher needs from the parsed intent. Field names follow the n8n payload. */
export interface MatchRequest {
  services: string[];
  /** As sent: "Multi-Service Package" for multi-service requests (n8n keyed complexity on it). */
  service_type: string | null;
  primary_service: string | null;
  is_multi_service: boolean;
  location: string;
  job_complexity: string | null;
  budget_sensitivity: string | null;
}

/** A business found near the customer, as the directory (OpenStreetMap today) returns it. */
export interface Place {
  /** Stable id, e.g. "osm:node/123456". Used as provider_id in bookings. */
  id: string;
  name: string;
  lat: number;
  lng: number;
  address: string;
  /** Requested services this place matched (by OSM tag or name). */
  matchedServices: string[];
  sourceUrl: string;
  /** Where the place came from. "demo_seed" places are fictional (db/seed/demo_providers.json). */
  source: ProviderSource;
}

export type ProviderSource = 'openstreetmap' | 'demo_seed';

/**
 * The provider schema WF2 produced and the frontend reads. Values the data
 * source does not have are null, never invented; `data_gaps` names them.
 */
export interface Provider {
  id: string;
  name: string;
  owner: string;
  services: string[];
  complexity_levels: Complexity[];
  areas: string[];
  coordinates: GeoPoint;
  address: string;
  base_rate_pkr: number;
  /** "gharfix_default": GharFix's standard rate, not a price the provider published. */
  base_rate_source: 'gharfix_default';
  rating: number | null;
  review_count: number | null;
  last_review_date: string | null;
  on_time_score: number | null;
  cancellation_rate: number | null;
  /** GharFix's bookable windows for this provider; the booking flow checks them against real bookings. */
  availability_slots: string[];
  active_bookings: number;
  max_daily_bookings: number;
  at_capacity: boolean;
  distance_km: number;
  /** Straight-line distance from the customer's geocoded location; no road routing. */
  distance_type: 'straight_line';
  verified: boolean;
  reputation_score: number | null;
  google_maps_url: string;
  osm_url: string;
  place_id: string;
  photos: string[];
  source: ProviderSource;
  data_gaps: string[];
}
