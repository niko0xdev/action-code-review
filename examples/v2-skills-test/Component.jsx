import { useState, useEffect } from 'react';

// Test fixture: V2 review should flag some React-specific issues
// 1. useEffect with missing dep array
// 2. Inline function in JSX (re-render trap)
// 3. setState directly mutating state
export default function Component({ items }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    console.log('count is', count);
  }); // ← MISSING DEP ARRAY - review should flag

  const handleClick = () => setCount(count + 1);

  return (
    <div onClick={handleClick}>
      <ul>
        {items.map((item, index) => (
          <li key={index} style={{ color: 'red' }}>  {/* ← inline style + index key */}
            {item.name}
          </li>
        ))}
      </ul>
      <p>Count: {count}</p>
    </div>
  );
}
