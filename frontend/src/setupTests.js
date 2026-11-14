// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// jsdom does not implement window.scrollTo; VolunTag scrolls to the top on
// every address change.
window.scrollTo = jest.fn();

// jsdom has no IntersectionObserver; the landing page's animated counters use
// one. This stub never reports anything as visible.
window.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
};
