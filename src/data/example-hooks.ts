import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post, put, del } from './api-client'

export interface ExampleItem {
  id: number
  name: string
  description?: string
}

export function useExampleItems() {
  return useQuery({
    queryKey: ['exampleItems'],
    queryFn: () => get<ExampleItem[]>('/items'),
  })
}

export function useExampleItem(id: number) {
  return useQuery({
    queryKey: ['exampleItem', id],
    queryFn: () => get<ExampleItem>(`/items/${id}`),
    enabled: !!id,
  })
}

export function useCreateExampleItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: Omit<ExampleItem, 'id'>) =>
      post<ExampleItem>('/items', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exampleItems'] })
    },
  })
}

export function useUpdateExampleItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, ...data }: Partial<ExampleItem> & { id: number }) =>
      put<ExampleItem>(`/items/${id}`, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['exampleItems'] })
      queryClient.invalidateQueries({ queryKey: ['exampleItem', variables.id] })
    },
  })
}

export function useDeleteExampleItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: number) => del(`/items/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exampleItems'] })
    },
  })
}
