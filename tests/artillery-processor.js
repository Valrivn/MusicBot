// Artillery processor for tRPC requests
// tRPC uses a specific JSON format for batch requests

function beforeRequest(requestParams, context, ee, next) {
  // Add tRPC batch format wrapper for POST requests to /api/trpc/*
  if (requestParams.url.startsWith('/api/trpc/') && requestParams.method === 'POST') {
    const procedure = requestParams.url.replace('/api/trpc/', '');
    const input = requestParams.json || {};
    
    // tRPC batch format
    requestParams.json = {
      "0": {
        json: input
      }
    };
    
    // Update URL to batch endpoint
    requestParams.url = '/api/trpc/' + procedure + '?batch=1';
  }
  
  return next();
}

function afterResponse(requestParams, response, context, ee, next) {
  // Log response for debugging
  if (response.statusCode >= 400) {
    console.log(`Error ${response.statusCode} for ${requestParams.url}: ${response.body}`);
  }
  return next();
}

module.exports = {
  beforeRequest,
  afterResponse,
};