// NGO profile fields and their rules, shared by the registration form and
// Settings. The server checks the same things (main.py add_ngo,
// schemas.NGOProfileUpdate).
import { safeExternalUrl } from "../../safeUrl";

export const NGO_CATEGORIES = [
  "Education",
  "Health",
  "Environment",
  "Animal Welfare",
  "Social Services",
];

export const MOTTO_MAX = 1000;
export const ADDRESS_MAX = 300;

const text = (value) => String(value ?? "");

/**
 * Errors for the editable profile fields ({} when valid), keyed by
 * contact_number, category, location, motto, website_url and address.
 */
export function validateNgoProfile(form) {
  const errs = {};

  if (!text(form.contact_number).trim()) {
    errs.contact_number = "Contact number is required";
  }

  if (!form.category) {
    errs.category = "Please select a category";
  }

  if (!text(form.location).trim()) {
    errs.location = "Location is required";
  }

  if (!text(form.motto).trim()) {
    errs.motto = "Motto is required";
  } else if (text(form.motto).trim().length > MOTTO_MAX) {
    errs.motto = `Keep it under ${MOTTO_MAX} characters`;
  }

  const website = text(form.website_url).trim();
  if (website && !safeExternalUrl(website)) {
    errs.website_url = "Enter a website address such as https://example.org";
  }

  if (text(form.address).trim().length > ADDRESS_MAX) {
    errs.address = `Keep it under ${ADDRESS_MAX} characters`;
  }

  return errs;
}
