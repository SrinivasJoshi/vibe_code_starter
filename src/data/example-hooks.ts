/**
 * Example React Query Hooks
 * 
 * This file shows example hooks for fetching data.
 * Replace these with your actual API endpoints and data types.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post, put, del } from './api-client'

// Example: Define your data types
export interface ExampleItem {
  id: number
  name: string
  description?: string
}

// Example: Fetch a list of items
export function useExampleItems() {
  return useQuery({
    queryKey: ['exampleItems'],
    queryFn: () => get<ExampleItem[]>('/api/items'),
  })
}

// Example: Fetch a single item by ID
export function useExampleItem(id: number) {
  return useQuery({
    queryKey: ['exampleItem', id],
    queryFn: () => get<ExampleItem>(`/api/items/${id}`),
    enabled: !!id, // Only fetch if ID exists
  })
}

// Example: Create a new item
export function useCreateExampleItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: Omit<ExampleItem, 'id'>) =>
      post<ExampleItem>('/api/items', data),
    onSuccess: () => {
      // Invalidate and refetch items list after creating
      queryClient.invalidateQueries({ queryKey: ['exampleItems'] })
    },
  })
}

// Example: Update an item
export function useUpdateExampleItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, ...data }: Partial<ExampleItem> & { id: number }) =>
      put<ExampleItem>(`/api/items/${id}`, data),
    onSuccess: (_, variables) => {
      // Invalidate both the list and the specific item
      queryClient.invalidateQueries({ queryKey: ['exampleItems'] })
      queryClient.invalidateQueries({ queryKey: ['exampleItem', variables.id] })
    },
  })
}

// Example: Delete an item
export function useDeleteExampleItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: number) => del(`/api/items/${id}`),
    onSuccess: () => {
      // Invalidate items list after deleting
      queryClient.invalidateQueries({ queryKey: ['exampleItems'] })
    },
  })
}
