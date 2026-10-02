import '@testing-library/jest-dom/vitest';
import { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useFieldArray, useForm } from 'react-hook-form';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreatePerformanceFormInput } from '@grabit/shared';

import { CastingManager } from '../casting-manager';

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  upload: vi.fn(),
  values: { current: null as null | (() => NonNullable<CreatePerformanceFormInput['castings']>) },
}));

vi.mock('@/hooks/use-admin', () => ({ usePresignedUpload: () => ({ mutateAsync: mocks.mutateAsync }) }));
vi.mock('@/lib/admin-upload', () => ({ uploadPresignedAsset: mocks.upload }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function CastingForm() {
  const form = useForm<CreatePerformanceFormInput>({
    defaultValues: { castings: [
      { actorName: '배우 A', roleName: null, photoUrl: null, sortOrder: 0 },
      { actorName: '배우 B', roleName: null, photoUrl: null, sortOrder: 1 },
      { actorName: '배우 C', roleName: null, photoUrl: null, sortOrder: 2 },
    ] } as Partial<CreatePerformanceFormInput> as CreatePerformanceFormInput,
  });
  const castings = useFieldArray({ control: form.control, name: 'castings' });
  useEffect(() => {
    mocks.values.current = () => form.getValues('castings') ?? [];
  }, [form]);
  return <>
    <CastingManager fields={castings.fields} append={castings.append} remove={castings.remove}
      register={form.register} setValue={form.setValue} control={form.control} />
    {/* Another path that drops a casting while its upload is running (e.g. a form reset). */}
    <button type="button" onClick={() => castings.remove(castings.fields.length - 1)}>마지막 캐스팅 제거</button>
  </>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const fileInputs = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));
const photo = () => new File(['photo'], 'photo.png', { type: 'image/png' });

describe('CastingManager photo upload', () => {
  const createObjectURL = vi.fn(() => 'blob:preview');
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    mocks.upload.mockResolvedValue(undefined);
  });

  afterEach(() => {
    mocks.values.current = null;
  });

  it('stores the uploaded photo on the same actor even if another card is deleted mid-upload', async () => {
    const user = userEvent.setup();
    const presign = deferred<{ uploadUrl: string; publicUrl: string; mode: 'r2'; cacheControl: null }>();
    mocks.mutateAsync.mockReturnValue(presign.promise);
    render(<CastingForm />);

    fireEvent.change(fileInputs()[1]!, { target: { files: [photo()] } });
    await user.click(screen.getByRole('button', { name: '배우 A delete' }));
    await user.click(screen.getByRole('button', { name: '삭제' }));
    await act(async () => {
      presign.resolve({ uploadUrl: 'https://upload.example/put', publicUrl: 'https://cdn.example/b.png', mode: 'r2', cacheControl: null });
    });

    await waitFor(() => expect(mocks.values.current?.()).toEqual([
      expect.objectContaining({ actorName: '배우 B', photoUrl: 'https://cdn.example/b.png' }),
      expect.objectContaining({ actorName: '배우 C', photoUrl: null }),
    ]));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  it('drops the result when the uploading actor itself was removed', async () => {
    const presign = deferred<{ uploadUrl: string; publicUrl: string; mode: 'r2'; cacheControl: null }>();
    mocks.mutateAsync.mockReturnValue(presign.promise);
    render(<CastingForm />);

    fireEvent.change(fileInputs()[2]!, { target: { files: [photo()] } });
    // The uploading card's own delete is disabled while its upload runs.
    expect(screen.getByRole('button', { name: '배우 C delete' })).toBeDisabled();
    await userEvent.setup().click(screen.getByRole('button', { name: '마지막 캐스팅 제거' }));
    await act(async () => {
      presign.resolve({ uploadUrl: 'https://upload.example/put', publicUrl: 'https://cdn.example/c.png', mode: 'r2', cacheControl: null });
    });

    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalled());
    expect(mocks.values.current?.().map((casting) => casting.photoUrl)).toEqual([null, null]);
  });

  it('removes the preview when the upload fails so the card shows what will be saved', async () => {
    mocks.mutateAsync.mockRejectedValue(new Error('network'));
    render(<CastingForm />);

    fireEvent.change(fileInputs()[0]!, { target: { files: [photo()] } });

    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview'));
    expect(screen.queryByRole('img', { name: '배우 A' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'casting photo upload' })).toHaveLength(3);
    expect(mocks.values.current?.()[0]?.photoUrl).toBeNull();
  });

  it('does not show an oversized photo that was never uploaded', async () => {
    render(<CastingForm />);
    const oversized = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });

    fireEvent.change(fileInputs()[0]!, { target: { files: [oversized] } });

    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview'));
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button', { name: 'casting photo upload' })).toHaveLength(3);
  });
});
