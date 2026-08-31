// Clean code with no security/memory/perf issues for V2 auto-approve test
function greet(name) {
  if (typeof name !== 'string') {
    throw new TypeError('Expected string');
  }
  return `Hello, ${name}!`;
}

module.exports = { greet };
