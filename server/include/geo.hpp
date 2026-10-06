#ifndef GEO_HPP
#define GEO_HPP

#include <cmath>

// Great-circle distance in kilometres between two lat/lng points (degrees).
inline double haversineKm(double lat1, double lng1, double lat2, double lng2) {
    const double kPi = 3.14159265358979323846;
    const double kEarthRadiusKm = 6371.0;
    double dLat = (lat2 - lat1) * kPi / 180.0;
    double dLng = (lng2 - lng1) * kPi / 180.0;
    double a = std::sin(dLat / 2) * std::sin(dLat / 2) +
               std::cos(lat1 * kPi / 180.0) * std::cos(lat2 * kPi / 180.0) *
                   std::sin(dLng / 2) * std::sin(dLng / 2);
    return 2.0 * kEarthRadiusKm * std::asin(std::sqrt(a));
}

// Roads are longer than the straight line between two points. Used to turn a crow-flies
// distance into a driving distance when a city file does not give an explicit weight.
const double ROAD_FACTOR = 1.25;

#endif
