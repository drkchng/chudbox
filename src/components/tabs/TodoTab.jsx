import { useState } from 'react'
import { Plus, Trash2, CheckSquare } from 'lucide-react'
import useGarageStore from '../../store/useGarageStore'

const PRIORITY = {
  low:    { label: 'Low',    class: 'bg-gray-800 text-gray-400 border-gray-700' },
  medium: { label: 'Medium', class: 'bg-blue-900/50 text-blue-300 border-blue-700/40' },
  high:   { label: 'High',   class: 'bg-red-900/50 text-red-300 border-red-700/40' },
}

export default function TodoTab({ car }) {
  const addTodo    = useGarageStore((s) => s.addTodo)
  const toggleTodo = useGarageStore((s) => s.toggleTodo)
  const deleteTodo = useGarageStore((s) => s.deleteTodo)
  const [text, setText] = useState('')
  const [priority, setPriority] = useState('medium')

  const handleAdd = (e) => {
    e.preventDefault()
    if (!text.trim()) return
    addTodo(car.id, text.trim(), priority)
    setText('')
  }

  const pending  = car.todos.filter((t) => !t.done).sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 }
    return order[a.priority] - order[b.priority]
  })
  const done = car.todos.filter((t) => t.done)

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-white font-semibold">To-Do List</h3>
        <span className="text-xs text-gray-500">{pending.length} pending · {done.length} done</span>
      </div>

      {/* Add form */}
      <form onSubmit={handleAdd} className="card mb-6 flex gap-3 items-end">
        <div className="flex-1">
          <label className="label">New Task</label>
          <input className="input" placeholder="Replace brake pads…" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="w-28">
          <label className="label">Priority</label>
          <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <button type="submit" className="btn-primary shrink-0"><Plus size={14} /> Add</button>
      </form>

      {car.todos.length === 0 ? (
        <div className="text-center py-16 text-gray-600">
          <CheckSquare size={36} className="mx-auto mb-3 opacity-40" />
          <p>No tasks yet.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Pending */}
          {pending.length > 0 && (
            <div className="space-y-2">
              {pending.map((todo) => (
                <div key={todo.id} className="card flex items-center gap-3 hover:border-accent/20 py-3">
                  <input type="checkbox" checked={false} onChange={() => toggleTodo(car.id, todo.id)}
                    className="w-4 h-4 rounded border-border accent-accent cursor-pointer shrink-0" />
                  <span className="flex-1 text-sm text-gray-200">{todo.text}</span>
                  <span className={`badge border text-xs ${PRIORITY[todo.priority].class}`}>{PRIORITY[todo.priority].label}</span>
                  <button onClick={() => deleteTodo(car.id, todo.id)} className="btn-ghost text-red-500 hover:text-red-400"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}

          {/* Done */}
          {done.length > 0 && (
            <div>
              <p className="text-xs text-gray-600 uppercase tracking-wide mb-2">Completed</p>
              <div className="space-y-2">
                {done.map((todo) => (
                  <div key={todo.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface/50 opacity-50">
                    <input type="checkbox" checked onChange={() => toggleTodo(car.id, todo.id)}
                      className="w-4 h-4 accent-accent cursor-pointer shrink-0" />
                    <span className="flex-1 text-sm text-gray-400 line-through">{todo.text}</span>
                    <button onClick={() => deleteTodo(car.id, todo.id)} className="btn-ghost text-red-500 hover:text-red-400"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
