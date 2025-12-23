/*
 * @Author: QinHao
 * @Date: 2025-12-19 17:46:59
 * @LastEditors: qinhao
 * @LastEditTime: 2025-12-23 10:58:14
 * @FilePath: \religious-imsd:\work\447519276.github.io\index.tsx
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error('Could not find root element to mount to');
}

const root = ReactDOM.createRoot(rootElement);
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
