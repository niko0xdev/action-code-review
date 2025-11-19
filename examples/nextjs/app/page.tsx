'use client';

import { useState } from 'react';

interface TodoItem {
  id: number;
  text: string;
  completed: boolean;
}

export default function HomePage(): JSX.Element {
  const [repository, setRepository] = useState('niko0xdev/action-code-review');
  const [todos, setTodos] = useState<TodoItem[]>([
    { id: 1, text: 'Review this PR', completed: false },
    { id: 2, text: 'Add more test cases', completed: true }
  ]);
  const [newTodo, setNewTodo] = useState('');

  const addTodo = () => {
    if (newTodo.trim()) {
      setTodos([...todos, { id: Date.now(), text: newTodo, completed: false }]);
      setNewTodo('');
    }
  };

  const toggleTodo = (id: number) => {
    setTodos(todos.map(todo => 
      todo.id === id ? { ...todo, completed: !todo.completed } : todo
    ));
  };

  const deleteTodo = (id: number) => {
    setTodos(todos.filter(todo => todo.id !== id));
  };

  return (
    <main className="container">
      <section>
        <h1>Next.js + AI Code Review</h1>
        <p>
          This mini app exists purely as a playground for the{' '}
          <code>niko0xdev/action-code-review</code> GitHub Action. Submit pull requests against
          this example to watch the AI bot annotate diffs automatically.
        </p>
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
        <h2>Todo Demo</h2>
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
                <button onClick={() => deleteTodo(todo.id)} className="delete-button">×</button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="card">
        <h2>Why this matters</h2>
        <ul>
          <li>Instant feedback on pull requests with inline comments.</li>
          <li>Tailored to web apps thanks to the Next.js sample.</li>
          <li>No need to leave GitHub – the review bot posts everything there.</li>
        </ul>
      </section>
    </main>
  );
}
