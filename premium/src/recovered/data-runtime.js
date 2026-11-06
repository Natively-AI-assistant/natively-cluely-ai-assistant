import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
export { QueryClient as Q, QueryClientProvider as a } from '@tanstack/react-query';
const getDefault = value => value && value.__esModule && Object.prototype.hasOwnProperty.call(value, 'default') ? value.default : value;
const getReact = () => React;
export { React as r, React as R, React as b, jsx as j, getDefault as g, getReact as c };
