import '@testing-library/jest-dom/vitest';

// jsdom has no layout, so scrolling is a no-op there.
window.scrollTo = () => undefined;
