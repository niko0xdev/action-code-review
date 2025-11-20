'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface TodoItem {
  id: number;
  text: string;
  completed: boolean;
  priority: 'low' | 'medium' | 'high';
  createdAt: Date;
}

interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
}

export default function HomePage(): JSX.Element {
  const [repository, setRepository] = useState('niko0xdev/action-code-review');
  const [todos, setTodos] = useState<TodoItem[]>([
    { id: 1, text: 'Review this PR', completed: false, priority: 'high', createdAt: new Date() },
    { id: 2, text: 'Add more test cases', completed: true, priority: 'medium', createdAt: new Date() },
    { id: 3, text: 'Fix security vulnerability', completed: false, priority: 'high', createdAt: new Date() }
  ]);
  const [newTodo, setNewTodo] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  // Example of potential security issue - missing dependency array
  useEffect(() => {
    fetchUserData();
  }, []);

  // Example of potential performance issue - inefficient array operation
  const addTodo = () => {
    if (newTodo.trim()) {
      const newId = Date.now();
      const newTodoItem: TodoItem = {
        id: newId,
        text: newTodo,
        completed: false,
        priority: 'medium',
        createdAt: new Date()
      };
      
      // Inefficient array operation - could be optimized
      const updatedTodos = [...todos];
      updatedTodos.push(newTodoItem);
      setTodos(updatedTodos);
      setNewTodo('');
    }
  };

  // Example of potential error handling issue
  const fetchUserData = async () => {
    try {
      // Missing error handling for fetch
      const response = await fetch('/api/user');
      const userData = await response.json();
      setUser(userData);
    } catch (error) {
      console.error('Failed to fetch user data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Example of potential security issue - direct DOM manipulation
  const toggleTodo = (id: number) => {
    setTodos(todos.map(todo => 
      todo.id === id ? { ...todo, completed: !todo.completed } : todo
    ));
  };

  // Example of potential performance issue - unnecessary re-renders
  const deleteTodo = (id: number) => {
    setTodos(todos.filter(todo => todo.id !== id));
  };

  // Example of potential security issue - eval usage (commented out for safety)
  // const evaluateExpression = (expr: string) => eval(expr);

  // Example of potential accessibility issue
  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return '#ff4444';
      case 'medium': return '#ffaa00';
      case 'low': return '#00aa00';
      default: return '#888888';
    }
  };

  if (isLoading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <main className="container">
      <section>
        <h1>Next.js + AI Code Review Demo</h1>
        <p>
          This enhanced demo app showcases various code patterns that the AI code reviewer can analyze.
          Submit pull requests against this example to see the AI bot identify issues like:
        </p>
        <ul>
          <li>Security vulnerabilities</li>
          <li>Performance bottlenecks</li>
          <li>Missing error handling</li>
          <li>Accessibility concerns</li>
          <li>Code quality issues</li>
        </ul>
      </section>

      <section className="card">
        <h2>Repository under review</h2>
        <label className="label">
          <span>owner/repo</span>
          <input value={repository} onChange={event => setRepository(event.target.value)} />
        </label>
        <p className="muted">
          Update the repository slug above and push a PR – the workflow configured in{' '}
          <code>.github/workflows/pr-review.yml</code> will call into the action bundled in this
          monorepo (see README).
        </p>
      </section>

      <section className="card">
        <h2>User Information</h2>
        {user ? (
          <div className="user-info">
            <p><strong>Name:</strong> {user.name}</p>
            <p><strong>Email:</strong> {user.email}</p>
            <p><strong>Role:</strong> {user.role}</p>
          </div>
        ) : (
          <p>No user data available</p>
        )}
      </section>

      <section className="card">
        <h2>Todo Demo with Priority</h2>
        <div className="todo-container">
          <div className="todo-input">
            <input 
              value={newTodo} 
              onChange={event => setNewTodo(event.target.value)} 
              placeholder="Add a new todo"
              onKeyPress={e => e.key === 'Enter' && addTodo()}
            />
            <button onClick={addTodo} className="add-button">Add</button>
          </div>
          <ul className="todo-list">
            {todos.map(todo => (
              <li key={todo.id} className={`todo-item ${todo.completed ? 'completed' : ''}`}>
                <input 
                  type="checkbox" 
                  checked={todo.completed} 
                  onChange={() => toggleTodo(todo.id)} 
                />
                <span className="todo-text">{todo.text}</span>
                <span 
                  className="priority-badge" 
                  style={{ backgroundColor: getPriorityColor(todo.priority) }}
                >
                  {todo.priority}
                </span>
                <button onClick={() => deleteTodo(todo.id)} className="delete-button">×</button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="card">
        <h2>Code Review Examples</h2>
        <p>This demo includes intentional code issues that the AI reviewer can identify:</p>
        <ul>
          <li><strong>Security:</strong> Missing input validation and potential XSS risks</li>
          <li><strong>Performance:</strong> Inefficient array operations and unnecessary re-renders</li>
          <li><strong>Error Handling:</strong> Incomplete error handling in async operations</li>
          <li><strong>Accessibility:</strong> Missing ARIA labels and color contrast issues</li>
          <li><strong>Code Quality:</strong> Code duplication and missing type safety</li>
        </ul>
      </section>
    </main>
  );
}
