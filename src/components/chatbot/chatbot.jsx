import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import './chatbot.css';
import loadingIcon from '../../assets/loading.svg';

// --- Gemini AI Setup ---
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

// Initialize with the new SDK structure
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Define the grounding tool for Google Search
const groundingTool = {
  functionDeclarations: [{
    name: 'google_search',
    description: 'Search Google for information to verify facts',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query'
        }
      },
      required: ['query']
    }
  }]
};
// --- End Gemini AI Setup ---

const Chatbot = () => {
  const [messages, setMessages] = useState([
    {
      id: 1,
      text: "Hello! Ask me anything. My responses can be fact-checked in real-time.",
      sender: 'bot',
      correction: null,
    }
  ]);
  const [input, setInput] = useState('');
  const [isContextEnabled, setIsContextEnabled] = useState(true);
  const [isFactCheckEnabled, setIsFactCheckEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages, isLoading]);

  const classifyStatementType = async (text) => {
    try {
      const prompt = `Analyze the following text. Is it making a specific, verifiable factual claim, or is it a general opinion, a piece of advice, a personal preference, or a subjective statement? Please respond with only the word 'FACT' or 'OPINION'.\n\nText: "${text}"`;
      
      // Use the new SDK structure
      const response = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: prompt,
      });
      
      const responseText = response.text.trim().toUpperCase();

      if (responseText.includes('FACT')) {
        return 'FACT';
      }
      return 'OPINION';
    } catch (error) {
      console.error("Error in classifying statement:", error);
      return 'OPINION';
    }
  };

  const getFactCheckCorrection = async (textToVerify) => {
    const type = await classifyStatementType(textToVerify);
    if (type === 'OPINION') {
      console.log("Statement is an opinion. Skipping fact-check.");
      return "Statement is an opinion. Skipping fact-check.";
    }

    try {
      const prompt = `You are a fact-checking assistant with access to Google Search. Your task is to verify the following statement by searching for relevant information online.

IMPORTANT INSTRUCTIONS:
1. ALWAYS search Google for information related to this statement before responding
2. Use multiple search queries if needed to thoroughly verify the claim
3. Based on your search results, determine if the statement is accurate or not
4. If the statement is accurate, respond with "CORRECT"
5. If the statement is inaccurate or partially incorrect, provide a brief correction based on the search results
6. Do NOT ask for more information - use Google Search to find what you need

Statement to verify: "${textToVerify}"

Please search for information about this statement and provide your fact-check result.`;
      
      // Use the new SDK structure with tools
      const response = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: prompt,
        config: {
          tools: [groundingTool],
          systemInstruction: "You are a proactive fact-checking assistant. Always use Google Search to verify statements. Never ask for more information - search for what you need to verify the claim. Provide clear, concise corrections when statements are inaccurate."
        }
      });

      // Handle the response properly - check if there are function calls or text
      let groundedResponse = '';
      
      if (response.text) {
        groundedResponse = response.text.trim();
      } else if (response.functionCalls && response.functionCalls.length > 0) {
        // If there are function calls, we need to handle them
        // For now, let's extract any text that might be available
        const candidates = response.candidates || [];
        if (candidates.length > 0 && candidates[0].content && candidates[0].content.parts) {
          const textParts = candidates[0].content.parts.filter(part => part.text);
          if (textParts.length > 0) {
            groundedResponse = textParts.map(part => part.text).join(' ').trim();
          }
        }
        
        // If still no text, provide a fallback message
        if (!groundedResponse) {
          groundedResponse = "Unable to complete fact-check due to technical limitations.";
        }
      } else {
        // Fallback if no text or function calls
        groundedResponse = "Unable to verify statement at this time.";
      }

      // Only return null if explicitly correct, otherwise return the correction
      if (groundedResponse.toUpperCase() === 'CORRECT' || 
          groundedResponse.toLowerCase().includes('the statement is correct') ||
          groundedResponse.toLowerCase().includes('this is accurate')) {
        return null;
      }
      
      return groundedResponse;
    } catch (error) {
      console.error("Error during Gemini fact-checking:", error);
      return "Fact-check service is currently unavailable.";
    }
  };

  const handlePlayWelcomeAudio = async () => {
    try {
      // Ensure your audio file is named 'welcome.wav' in the public folder
      const audio = new Audio('/welcome.wav');
      await audio.play();
    } catch (error) {
      console.error("Failed to play welcome audio:", error);
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const processedInput = input.trim().endsWith('?') ? input.trim() : `${input.trim()}?`;

    const userMessage = { id: Date.now(), text: processedInput, sender: 'user', correction: null };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    let promptWithContext = processedInput;
    if (isContextEnabled) {
      const history = messages.slice(-4);
      const context = history.map(msg => msg.text).join('\n\n');
      promptWithContext = `Previous conversation:\n${context}\n\nCurrent question: ${processedInput}`;
    }

    try {
      const endpoint = "https://gravitymygirl--generate.modal.run";
      const params = new URLSearchParams({ prompt: promptWithContext, max_new_tokens: 256 });
      
      const response = await fetch(`${endpoint}?${params.toString()}`, { method: 'POST' });
      if (!response.ok) throw new Error(`Custom LLM error! status: ${response.status}`);
      
      const data = await response.json();
      if (!data.response) throw new Error("Invalid response from custom LLM.");

      let correction = null;
      if (isFactCheckEnabled) {
        correction = await getFactCheckCorrection(data.response);
      }

      const botMessage = { 
        id: Date.now() + 1, 
        text: data.response, 
        sender: 'bot',
        correction: correction,
      };
      setMessages(prev => [...prev, botMessage]);

    } catch (error) {
      console.error("Failed to fetch from LLM endpoint:", error);
      const errorMessage = { 
        id: Date.now() + 1, 
        text: "Sorry, I'm having trouble connecting. Please try again later.", 
        sender: 'bot',
        isError: true,
        correction: null,
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="chatbot">
      <div className="chat-window">
        {messages.map(msg => (
          <div key={msg.id} className={`message-container ${msg.sender}`}>
            <div className={`message ${msg.sender} ${msg.isError ? 'error' : ''}`}>
              {msg.text}
            </div>
            {msg.sender === 'bot' && msg.id === 1 && (
              <button className="play-audio-button" onClick={handlePlayWelcomeAudio}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                Play Welcome
              </button>
            )}
            {msg.correction && (
              <div className="correction-box">
                <strong>Verified Correction:</strong> {msg.correction}
              </div>
            )}
          </div>
        ))}
        {isLoading && (
          <div className="message-container bot">
            <div className="message bot">
              <img src={loadingIcon} alt="Loading..." className="loading-icon" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      
      <div className="bottom-section">
        <div className="toggles-container">
          <div className="toggle-wrapper">
            <label htmlFor="context-switch">Conversation Context</label>
            <button 
              id="context-switch"
              className={`switch ${isContextEnabled ? 'on' : 'off'}`}
              onClick={() => setIsContextEnabled(!isContextEnabled)}
              aria-pressed={isContextEnabled}
            >
              <span>{isContextEnabled ? 'ON' : 'OFF'}</span>
            </button>
          </div>
          <div className="toggle-wrapper">
            <label htmlFor="fact-check-switch">Real-time Verification</label>
            <button 
              id="fact-check-switch"
              className={`switch ${isFactCheckEnabled ? 'on' : 'off'}`}
              onClick={() => setIsFactCheckEnabled(!isFactCheckEnabled)}
              aria-pressed={isFactCheckEnabled}
            >
              <span>{isFactCheckEnabled ? 'ON' : 'OFF'}</span>
            </button>
          </div>
        </div>
        <p className="disclaimer">
          {isFactCheckEnabled && "Model can hallucinate, so real-time verification is enabled."}
        </p>
        <form className="chat-input-form" onSubmit={handleSend}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            disabled={isLoading}
          />
          <button type="submit" disabled={isLoading || !input.trim()}>
             <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </form>
      </div>
    </div>
  );
};

export default Chatbot;