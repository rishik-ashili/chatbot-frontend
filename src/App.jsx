// src/App.jsx
import React from 'react';
import Chatbot from './components/chatbot/chatbot';
import './App.css';

function App() {
  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Chat with <span>Harshil's AI Twin</span></h1>
      </header>
      <Chatbot />
    </div>
  );
}

export default App;