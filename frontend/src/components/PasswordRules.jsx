import { useState } from "react";
import "./PasswordRules.css";

// Mirrors backend/password_policy.py, which enforces the same rules on the
// server. Keep the two in step when changing a rule. The password is checked
// exactly as typed: nothing is trimmed or altered.

const MIN_LENGTH = 8;
const MAX_LENGTH = 64;

const LETTER = /\p{L}/u;
const UPPERCASE = /\p{Lu}/u;
const LOWERCASE = /\p{Ll}/u;
const DIGIT = /\p{Nd}/u;

// The exact characters Python's str.isspace() accepts, so the browser and
// the server agree on what counts as whitespace.
const WHITESPACE = new Set([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0,
  0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
  0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
]);

const isSpecial = (char) =>
  !LETTER.test(char) &&
  !DIGIT.test(char) &&
  !WHITESPACE.has(char.codePointAt(0));

// Spreading a string splits it by code point, matching Python's len().
const chars = (password) => [...password];

export const PASSWORD_RULES = [
  {
    id: "length",
    label: `${MIN_LENGTH} to ${MAX_LENGTH} characters`,
    test: (password) => {
      const length = chars(password).length;
      return length >= MIN_LENGTH && length <= MAX_LENGTH;
    },
  },
  {
    id: "upper",
    label: "An uppercase letter",
    test: (password) => chars(password).some((c) => UPPERCASE.test(c)),
  },
  {
    id: "lower",
    label: "A lowercase letter",
    test: (password) => chars(password).some((c) => LOWERCASE.test(c)),
  },
  {
    id: "digit",
    label: "A digit",
    test: (password) => chars(password).some((c) => DIGIT.test(c)),
  },
  {
    id: "special",
    label: "A special character (not a letter, digit or space)",
    test: (password) => chars(password).some(isSpecial),
  },
];

export const meetsPasswordPolicy = (password) =>
  PASSWORD_RULES.every((rule) => rule.test(password));

export function PasswordField({ id, value, onChange, hasError }) {
  const [visible, setVisible] = useState(false);
  const rulesId = `${id}-rules`;

  return (
    <>
      <div className="pw-field">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`pw-field__input ${hasError ? "input-error" : ""}`}
          autoComplete="new-password"
          aria-describedby={rulesId}
        />

        <button
          type="button"
          className="pw-field__toggle"
          onClick={() => setVisible((v) => !v)}
          aria-controls={id}
          aria-pressed={visible}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>

      <ul className="pw-rules" id={rulesId} aria-live="polite">
        {PASSWORD_RULES.map((rule) => {
          const met = rule.test(value);

          return (
            <li
              key={rule.id}
              className={`pw-rule ${met ? "pw-rule--met" : ""}`}
            >
              <span className="pw-rule__mark" aria-hidden="true">
                {met ? "✓" : "○"}
              </span>
              <span className="pw-sr-only">
                {met ? "Done: " : "Needed: "}
              </span>
              {rule.label}
            </li>
          );
        })}
      </ul>
    </>
  );
}
