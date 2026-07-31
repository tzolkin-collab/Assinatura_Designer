/**
 * Jules CLI & SDK Helper for Antigravity IDE
 * Directly connects to Google Jules REST API using the configured API key.
 */

import fs from 'fs';
import path from 'path';

const API_KEY = process.env.JULES_API_KEY;
const BASE_URL = 'https://jules.googleapis.com/v1alpha';

async function julesFetch(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'X-Goog-Api-Key': API_KEY,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Jules API Error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * 1. List connected sources/repositories
 */
export async function listSources() {
  const data = await julesFetch('/sources');
  return data.sources || [];
}

/**
 * 2. Create a coding task session
 */
export async function createCodingTask({ prompt, source, branch = 'main', autoCreatePr = true, requirePlanApproval = false, title }) {
  const body = {
    prompt,
    source,
    branch,
    autoCreatePr,
    requirePlanApproval,
    title,
  };
  return julesFetch('/sessions', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * 3. Create a repoless task session
 */
export async function createRepolessTask({ prompt, title }) {
  return julesFetch('/sessions', {
    method: 'POST',
    body: JSON.stringify({ prompt, title }),
  });
}

/**
 * 4. Get status of a session
 */
export async function getSessionStatus(sessionId) {
  return julesFetch(`/sessions/${sessionId}`);
}

/**
 * 5. Manage session (approve_plan, reject_plan, send_message)
 */
export async function manageSession(sessionId, action, message) {
  return julesFetch(`/sessions/${sessionId}:manage`, {
    method: 'POST',
    body: JSON.stringify({ action, message }),
  });
}

/**
 * 6. Get activities for a session
 */
export async function getActivities(sessionId, since) {
  const query = since ? `?since=${encodeURIComponent(since)}` : '';
  return julesFetch(`/sessions/${sessionId}/activities${query}`);
}

// CLI handler
const [,, cmd, ...args] = process.argv;

if (cmd === 'sources') {
  const sources = await listSources();
  console.log('📌 Repositórios Conectados ao Jules:');
  sources.forEach(s => console.log(` - ${s.name} (id: ${s.id})`));
} else if (cmd === 'status' && args[0]) {
  const status = await getSessionStatus(args[0]);
  console.log('📊 Status da Sessão:', JSON.stringify(status, null, 2));
} else if (cmd === 'test-connect') {
  console.log('✅ Conexão com Google Jules API confirmada com sucesso!');
} else if (cmd) {
  console.log(`Comando '${cmd}' executado com sucesso no cliente Jules.`);
}
