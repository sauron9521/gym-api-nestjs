export type PaginationMeta = {
  total: number;
  skip: number;
  take: number;
  totalPages: number;
};

export type PaginatedResult<T> = {
  data: T[];
  meta: PaginationMeta;
};
