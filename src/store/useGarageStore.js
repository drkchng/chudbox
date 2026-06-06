import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import localforage from 'localforage'
import { CURRENCIES, convertPrice, convertDistance } from '../utils/units'

const idbStorage = {
  getItem: (name) => localforage.getItem(name),
  setItem: (name, value) => localforage.setItem(name, value),
  removeItem: (name) => localforage.removeItem(name),
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
const now = () => new Date().toISOString()

const useGarageStore = create(
  persist(
    (set, get) => ({
      cars: [],

      // ── Theme ─────────────────────────────────────────
      themeId: 'garage',
      customAccent: null,

      setTheme: (themeId) => set({ themeId, customAccent: null }),
      setCustomAccent: (hex) => set({ themeId: 'custom', customAccent: hex }),

      // ── Settings ──────────────────────────────────────
      currency: 'USD',
      distanceUnit: 'mi',

      setCurrency: (to) => set((s) => {
        const from = s.currency
        if (from === to || !CURRENCIES[to]) return {}
        const conv = (val) => convertPrice(val, from, to)
        return {
          currency: to,
          cars: s.cars.map((car) => ({
            ...car,
            salePrice: conv(car.salePrice),
            mods: car.mods.map((m) => ({ ...m, cost: conv(m.cost) })),
            maintenance: car.maintenance.map((r) => ({ ...r, cost: conv(r.cost) })),
            wishlist: car.wishlist.map((i) => ({ ...i, price: conv(i.price) })),
          })),
        }
      }),

      setDistanceUnit: (to) => set((s) => {
        const from = s.distanceUnit
        if (from === to) return {}
        const conv = (val) => convertDistance(val, from, to)
        return {
          distanceUnit: to,
          cars: s.cars.map((car) => ({
            ...car,
            mileage: conv(car.mileage),
            maintenance: car.maintenance.map((r) => ({
              ...r,
              mileage:       conv(r.mileage),
              nextDueMileage: conv(r.nextDueMileage),
            })),
          })),
        }
      }),

      // ── Cars ──────────────────────────────────────────
      addCar: (data) => set((s) => ({
        cars: [...s.cars, { ...data, id: uid(), photos: [], wishlist: [], mods: [], maintenance: [], todos: [], issues: [], createdAt: now() }],
      })),

      updateCar: (id, data) => set((s) => ({
        cars: s.cars.map((c) => (c.id === id ? { ...c, ...data } : c)),
      })),

      deleteCar: (id) => set((s) => ({ cars: s.cars.filter((c) => c.id !== id) })),

      getCar: (id) => get().cars.find((c) => c.id === id),

      // ── Photos ────────────────────────────────────────
      addPhoto: (carId, { dataUrl, caption }) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, photos: [...c.photos, { id: uid(), dataUrl, caption, uploadedAt: now() }],
        }),
      })),

      deletePhoto: (carId, photoId) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, photos: c.photos.filter((p) => p.id !== photoId),
          coverPhoto: c.coverPhoto === photoId ? null : c.coverPhoto,
        }),
      })),

      setCoverPhoto: (carId, photoId) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : { ...c, coverPhoto: photoId }),
      })),

      // ── Wishlist ──────────────────────────────────────
      addWishlistItem: (carId, data) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, wishlist: [...c.wishlist, { ...data, id: uid(), status: 'wanted', addedAt: now() }],
        }),
      })),

      updateWishlistItem: (carId, itemId, data) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, wishlist: c.wishlist.map((i) => i.id === itemId ? { ...i, ...data } : i),
        }),
      })),

      deleteWishlistItem: (carId, itemId) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, wishlist: c.wishlist.filter((i) => i.id !== itemId),
        }),
      })),

      // ── Mods ──────────────────────────────────────────
      addMod: (carId, data) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, mods: [...c.mods, { ...data, id: uid(), addedAt: now() }],
        }),
      })),

      updateMod: (carId, modId, data) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, mods: c.mods.map((m) => m.id === modId ? { ...m, ...data } : m),
        }),
      })),

      deleteMod: (carId, modId) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, mods: c.mods.filter((m) => m.id !== modId),
        }),
      })),

      // ── Maintenance ───────────────────────────────────
      addMaintenance: (carId, data) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, maintenance: [...c.maintenance, { ...data, id: uid(), createdAt: now() }],
        }),
      })),

      updateMaintenance: (carId, recId, data) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, maintenance: c.maintenance.map((r) => r.id === recId ? { ...r, ...data } : r),
        }),
      })),

      deleteMaintenance: (carId, recId) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, maintenance: c.maintenance.filter((r) => r.id !== recId),
        }),
      })),

      // ── Todos ─────────────────────────────────────────
      addTodo: (carId, text, priority = 'medium') => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, todos: [...c.todos, { id: uid(), text, priority, done: false, createdAt: now() }],
        }),
      })),

      toggleTodo: (carId, todoId) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, todos: c.todos.map((t) => t.id === todoId ? { ...t, done: !t.done } : t),
        }),
      })),

      deleteTodo: (carId, todoId) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, todos: c.todos.filter((t) => t.id !== todoId),
        }),
      })),

      updateTodo: (carId, todoId, data) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, todos: c.todos.map((t) => t.id === todoId ? { ...t, ...data } : t),
        }),
      })),

      // ── Issues ────────────────────────────────────────
      addIssue: (carId, data) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, issues: [...c.issues, { ...data, id: uid(), status: 'open', createdAt: now() }],
        }),
      })),

      updateIssue: (carId, issueId, data) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, issues: c.issues.map((i) => i.id === issueId ? { ...i, ...data } : i),
        }),
      })),

      deleteIssue: (carId, issueId) => set((s) => ({
        cars: s.cars.map((c) => c.id !== carId ? c : {
          ...c, issues: c.issues.filter((i) => i.id !== issueId),
        }),
      })),
    }),
    {
      name: 'garage-store',
      storage: createJSONStorage(() => idbStorage),
    }
  )
)

export default useGarageStore
