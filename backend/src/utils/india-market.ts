const CITY_ALIASES: Record<string, string> = {
  mumbai: "Mumbai",
  bombay: "Mumbai",
  "navi mumbai": "Mumbai",
  "new mumbai": "Mumbai",
  delhi: "Delhi",
  "new delhi": "Delhi",
  "delhi ncr": "Delhi",
  ncr: "Delhi",
  gurgaon: "Gurugram",
  gurugram: "Gurugram",
  noida: "Noida",
  "greater noida": "Noida",
  bengaluru: "Bengaluru",
  bangalore: "Bengaluru",
  bengalore: "Bengaluru",
  hyderabad: "Hyderabad",
  secunderabad: "Hyderabad",
  chennai: "Chennai",
  madras: "Chennai",
  pune: "Pune",
  poona: "Pune",
  lucknow: "Lucknow",
  jaipur: "Jaipur",
  ahmedabad: "Ahmedabad",
};

function toTitleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function normalizeIndianCityName(rawCity: unknown): string {
  const city = String(rawCity || "")
    .trim()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ");

  if (!city) return "Mumbai";

  const key = city.toLowerCase();
  return CITY_ALIASES[key] || toTitleCase(city);
}

export function normalizeIndianPhone(rawPhone: unknown): string {
  const digits = String(rawPhone || "").replace(/\D/g, "");

  if (digits.length === 12 && digits.startsWith("91")) {
    return digits.slice(2);
  }

  if (digits.length > 10) {
    return digits.slice(-10);
  }

  return digits;
}

export function isValidIndianMobile(phone: string): boolean {
  return /^[6-9]\d{9}$/.test(phone);
}
