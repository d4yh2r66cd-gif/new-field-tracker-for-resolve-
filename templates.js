// Each site type carries its own commissioning checklist and the readings that
// are meaningful on that kind of site. Add a type here and it appears in the app
// with no other changes.

const SITE_TYPES = {
  agro_processing: {
    label: "Agro-processing plant",
    accent: "agro",
    stages: [
      "Delivered to site",
      "Foundation & base",
      "Positioned & anchored",
      "Mechanical assembly",
      "Electrical & controls",
      "Alignment & calibration",
      "No-load test run",
      "Load test with feedstock",
      "Operator training",
      "Commissioned & handed over",
    ],
    readings: [
      { key: "throughput", label: "Throughput", unit: "kg/hr" },
      { key: "moisture", label: "Product moisture", unit: "%", min: 8, max: 13 },
      { key: "dryer_temp", label: "Dryer temperature", unit: "°C", min: 120, max: 180 },
      { key: "current", label: "Line current draw", unit: "A" },
    ],
  },

  met_station: {
    label: "Meteorological station",
    accent: "met",
    stages: [
      "Site survey & permissions",
      "Mast foundation cast",
      "Mast erected & guyed",
      "Sensors mounted",
      "Data logger installed",
      "Power & solar connected",
      "Comms link established",
      "Sensor calibration",
      "Seven-day data validation",
      "Commissioned & handed over",
    ],
    readings: [
      { key: "air_temp", label: "Air temperature", unit: "°C" },
      { key: "humidity", label: "Relative humidity", unit: "%", min: 0, max: 100 },
      { key: "pressure", label: "Barometric pressure", unit: "hPa", min: 940, max: 1050 },
      { key: "wind_speed", label: "Wind speed", unit: "m/s" },
      { key: "rainfall", label: "Rainfall", unit: "mm" },
      { key: "battery", label: "Logger battery", unit: "V", min: 11.8, max: 14.5 },
    ],
  },

  petroleum_lab: {
    label: "Petroleum laboratory",
    accent: "petro",
    stages: [
      "Site readiness check",
      "Benches & fume hood installed",
      "Utilities connected",
      "Instruments positioned",
      "Installation qualification (IQ)",
      "Operational qualification (OQ)",
      "Reference standards verified",
      "Method validation",
      "Analyst training",
      "Commissioned & handed over",
    ],
    readings: [
      { key: "density", label: "Density at 15°C", unit: "kg/m³" },
      { key: "flash_point", label: "Flash point", unit: "°C" },
      { key: "sulphur", label: "Sulphur content", unit: "ppm" },
      { key: "lab_temp", label: "Laboratory temperature", unit: "°C", min: 18, max: 25 },
      { key: "lab_humidity", label: "Laboratory humidity", unit: "%", min: 35, max: 65 },
    ],
  },

  cold_chain: {
    label: "Cold chain facility",
    accent: "cold",
    stages: [
      "Delivered to site",
      "Room panels erected",
      "Condenser & evaporator mounted",
      "Refrigerant lines & charge",
      "Electrical & controls",
      "Temperature mapping",
      "Alarm & monitoring test",
      "Pull-down test",
      "Operator training",
      "Commissioned & handed over",
    ],
    readings: [
      { key: "room_temp", label: "Room temperature", unit: "°C", min: 2, max: 8 },
      { key: "ambient", label: "Ambient temperature", unit: "°C" },
      { key: "compressor_hours", label: "Compressor run hours", unit: "hrs" },
      { key: "door_openings", label: "Door openings", unit: "count" },
    ],
  },

  general: {
    label: "General field site",
    accent: "general",
    stages: [
      "Mobilisation",
      "Site survey",
      "Works in progress",
      "Testing",
      "Client inspection",
      "Demobilisation & handover",
    ],
    readings: [],
  },
};

function typeOf(key) {
  return SITE_TYPES[key] || SITE_TYPES.general;
}

// A reading is flagged when the site type declares a range and the value is outside it.
function outOfRange(siteType, key, value) {
  const def = typeOf(siteType).readings.find((r) => r.key === key);
  if (!def || value == null) return false;
  if (def.min != null && value < def.min) return true;
  if (def.max != null && value > def.max) return true;
  return false;
}

module.exports = { SITE_TYPES, typeOf, outOfRange };
