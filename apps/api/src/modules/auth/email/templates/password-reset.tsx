import { Html, Head, Body, Container, Heading, Text, Button, Hr, Section } from '@react-email/components';
import type { SupportedLocale } from '@grabit/shared';

interface PasswordResetEmailProps {
  resetLink: string;
  locale?: SupportedLocale;
}

const COPY = {
  ko: { title: '비밀번호 재설정 안내', subject: '[Grabit] 비밀번호 재설정', body: '아래 버튼을 눌러 비밀번호를 재설정해주세요. 이 링크는 1시간 동안만 유효합니다.', cta: '비밀번호 재설정', ignore: '본 메일을 요청하지 않으셨다면 무시하셔도 됩니다.' },
  en: { title: 'Reset your password', subject: '[Grabit] Reset your password', body: 'Use the button below to reset your password. This link is valid for one hour.', cta: 'Reset password', ignore: 'If you did not request this email, you can ignore it.' },
  th: { title: 'ตั้งรหัสผ่านใหม่', subject: '[Grabit] ตั้งรหัสผ่านใหม่', body: 'กดปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่ ลิงก์นี้ใช้ได้เป็นเวลา 1 ชั่วโมง', cta: 'ตั้งรหัสผ่านใหม่', ignore: 'หากคุณไม่ได้ขออีเมลนี้ คุณสามารถละเว้นได้' },
  'zh-CN': { title: '重置密码', subject: '[Grabit] 重置密码', body: '点击下方按钮重置密码。此链接在一小时内有效。', cta: '重置密码', ignore: '如果您没有请求此邮件，请忽略。' },
} satisfies Record<SupportedLocale, { title: string; subject: string; body: string; cta: string; ignore: string }>;

export function getPasswordResetCopy(locale: SupportedLocale) { return COPY[locale]; }

/**
 * PasswordResetEmail — React Email template for Grabit password reset flow.
 * Phase 9 DEBT-01: replaces the console.log stub in auth.service.ts.
 *
 * Resend SDK accepts the JSX element via `react` param (no render() call).
 */
export function PasswordResetEmail({ resetLink, locale = 'ko' }: PasswordResetEmailProps) {
  const copy = getPasswordResetCopy(locale);
  return (
    <Html lang={locale}>
      <Head />
      <Body style={{ backgroundColor: '#f5f5f7', fontFamily: 'system-ui, sans-serif' }}>
        <Container style={{ backgroundColor: '#ffffff', padding: '32px', maxWidth: '560px' }}>
          <Heading style={{ fontSize: '20px', color: '#1A1A2E' }}>{copy.title}</Heading>
          <Text style={{ fontSize: '14px', color: '#4A4A5E' }}>
            {copy.body}
          </Text>
          <Section style={{ textAlign: 'center', margin: '24px 0' }}>
            <Button
              href={resetLink}
              style={{
                backgroundColor: '#6C3CE0',
                color: '#ffffff',
                padding: '12px 24px',
                borderRadius: '6px',
              }}
            >
              {copy.cta}
            </Button>
          </Section>
          <Hr />
          <Text style={{ fontSize: '12px', color: '#6B6B7B' }}>
            {copy.ignore}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
