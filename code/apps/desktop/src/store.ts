import { create } from 'zustand';

type CounterState = {
  count: number;
  inc: () => void;
  reset: () => void;
};

export const useCounter = create<CounterState>((set) => ({
  count: 0,
  inc: () => set((s) => ({ count: s.count + 1 })),
  reset: () => set({ count: 0 }),
}));
