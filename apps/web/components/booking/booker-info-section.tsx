'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { useForm } from 'react-hook-form';
import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getCheckoutCopy } from '@/lib/booking/checkout-copy';
import { resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';

interface BookerFormData { name: string; phone: string }

export function BookerInfoSection({ userName, userPhone, userEmail, emailVerified, onUpdate }: {
  userName: string;
  userPhone: string;
  userEmail?: string;
  emailVerified?: boolean;
  onUpdate: (data: BookerFormData) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const copy = getCheckoutCopy(resolveVisibleCopyLocale(useLocale()));
  const { register, handleSubmit, formState: { errors }, reset } = useForm<BookerFormData>({
    defaultValues: { name: userName, phone: userPhone },
  });

  function onSubmit(data: BookerFormData) {
    onUpdate({ name: data.name.trim(), phone: data.phone.trim() });
    setIsEditing(false);
  }

  return (
    <section aria-label={copy.booker} className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold">{copy.booker}</h2>
        {!isEditing && <Button variant="outline" size="sm" onClick={() => {
          reset({ name: userName, phone: userPhone });
          setIsEditing(true);
        }}>{copy.edit}</Button>}
      </div>
      {isEditing ? (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="booker-name">{copy.name}</Label>
            <Input id="booker-name" autoComplete="name" aria-invalid={Boolean(errors.name)} {...register('name', {
              validate: (value) => value.trim().length > 0 || copy.nameRequired,
            })} />
            {errors.name && <p role="alert" className="text-sm text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="booker-phone">{copy.phone}</Label>
            <Input id="booker-phone" type="tel" autoComplete="tel" placeholder="+82 10 1234 5678" aria-invalid={Boolean(errors.phone)} {...register('phone', {
              validate: (value) => Boolean(parsePhoneNumberFromString(value, 'KR')?.isValid()) || copy.phoneInvalid,
            })} />
            {errors.phone && <p role="alert" className="text-sm text-destructive">{errors.phone.message}</p>}
          </div>
          <div className="flex gap-2"><Button type="submit" size="sm">{copy.save}</Button><Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(false)}>{copy.cancel}</Button></div>
        </form>
      ) : (
        <div className="space-y-2 text-sm text-muted-foreground md:text-base">
          <p className="font-medium text-foreground">{userName}</p><p>{userPhone}</p>
          {userEmail && <p className="break-all">{userEmail}</p>}
          {emailVerified && <p className="flex items-center gap-2 text-sm"><CheckCircle2 className="size-4 text-primary" />{copy.emailVerified}</p>}
        </div>
      )}
    </section>
  );
}
