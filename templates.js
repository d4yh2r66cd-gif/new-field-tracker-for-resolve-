// Each site type carries its own commissioning checklist and the readings that
// are meaningful on that kind of site. Add a type here and it appears in the app
// with no other changes.

const SITE_TYPES = {
  agro_processing: {
    label: "Agro-processing plant",
    accent: "agro",
    // Process machinery (cleaners, washers, peelers, presses, mills, packers…) isn't
    // calibrated the way a lab instrument or sensor is — so this column is N/A here.
    calibration: false,
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
    readings: [],
    // Suggested names shown while adding equipment — a starting point, not a restriction.
    equipment: [
      "Cage-type Cleaner", "Paddle Boat Washer", "Peeler", "Grater", "Hydraulic Press",
      "Sifting Machine", "Fryer", "Conveyor", "Vibrator", "Milling Machine",
      "Packaging Machine", "Scale",
    ],
  },

  poultry_processing: {
    label: "Poultry processing plant",
    accent: "poultry",
    // Same reasoning as agro-processing — this is process/mechanical line equipment.
    calibration: false,
    stages: [
      "Delivered to site",
      "Foundation & base",
      "Positioned & anchored",
      "Mechanical assembly",
      "Electrical & controls",
      "Sanitation & hygiene clearance",
      "No-load test run",
      "Load test with live product",
      "Operator training",
      "Commissioned & handed over",
    ],
    readings: [],
    equipment: [
      "Live Bird Receiving Cage", "Scalder", "Plucker", "Evisceration Table",
      "Giblet Harvester", "Chiller", "Cut-up Machine", "Deboning Machine",
      "Grading & Sizing Machine", "Packaging Machine", "Metal Detector", "Blast Freezer",
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
    equipment: [
      "Weather Station", "Anemometer", "Rain Gauge", "Barometer",
      "Temperature Sensor", "Humidity Sensor", "Pyranometer (Solar Radiation Sensor)",
      "Wind Vane", "Data Logger", "Lightning Detector", "Solar Panel & Battery Bank",
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
    equipment: [
      "Gum Tester (Jet Evaporation)", "Flash Point Tester", "Distillation Apparatus",
      "Viscometer", "Density Meter", "Karl Fischer Titrator", "Sulphur Analyzer (XRF)",
      "Octane Number Analyzer", "Cold Filter Plugging Point (CFPP) Tester",
      "Reid Vapor Pressure (RVP) Tester", "Corrosion Test Bath (Copper Strip)",
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
    equipment: [
      "Cold Room Panels", "Condensing Unit", "Evaporator Coil", "Compressor",
      "Temperature Data Logger", "Door Alarm System", "Backup Generator",
      "Insulated Strip Door", "Defrost Heater", "Refrigerant Charging Station",
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
    equipment: [],
  },
};

module.exports = { SITE_TYPES };
