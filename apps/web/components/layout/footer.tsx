import Link from 'next/link';

export function Footer() {
  return (
    <footer className="mt-auto min-h-[120px] bg-gray-100">
      <div className="mx-auto max-w-[1200px] px-6 py-8">
        {/* Legal links */}
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-900">
          <Link href="/legal/terms" className="hover:underline">
            이용약관
          </Link>
          <span className="text-gray-400">|</span>
          <Link href="/legal/privacy" className="font-semibold hover:underline">
            개인정보처리방침
          </Link>
          <span className="text-gray-400">|</span>
          <a href="mailto:support@heygrabit.com" className="hover:underline">
            고객센터
          </a>
        </div>

        {/* Copyright */}
        <p className="mt-4 text-sm text-gray-500">
          &copy; 2026 Grabit. All rights reserved.
        </p>

        <div className="mt-4 grid gap-2 text-caption leading-relaxed text-gray-600 sm:grid-cols-2">
          <p>사업자명: (주)아이콘스</p>
          <p>대표자: 정승준</p>
          <p>사업자등록번호: 109-86-27576</p>
          <p>통신판매업 신고번호: 2025-서울마포-1494</p>
          <p>사업장 주소: 서울특별시 마포구 월드컵로8길 69</p>
          <p>고객센터: 02-325-179</p>
          <p>개인정보 보호책임자: 정승준</p>
          <p>
            개인정보 문의:{' '}
            <a href="mailto:privacy@heygrabit.com" className="hover:underline">
              privacy@heygrabit.com
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
