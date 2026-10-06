import http from 'node:http';
// Stand-in for the customer's application; this is not a TraceGenie endpoint.
const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain' });
  response.end('Your application and TraceGenie are running in the same container.\n');
});
server.listen(3000, '0.0.0.0');
process.on('SIGTERM', () => server.close(() => process.exit(0)));
