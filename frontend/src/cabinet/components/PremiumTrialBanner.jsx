import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { dismissUiNotice, fetchTutorOffer } from "../../utils/cabinetAuth";

export default function PremiumTrialBanner() {
  const [banner, setBanner] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchTutorOffer()
      .then((data) => {
        if (!cancelled) setBanner(data?.banner || null);
      })
      .catch(() => {
        if (!cancelled) setBanner(null);
      });
    return () => { cancelled = true; };
  }, []);

  if (!banner?.visible || !banner.text) return null;

  const dismiss = async () => {
    setBanner(null);
    try {
      await dismissUiNotice(banner.notice_key || "premium_trial_tutor_offer");
    } catch {
      setBanner(banner);
    }
  };

  return (
    <aside className="td-card td-offer-banner" aria-label="Предложение для пробного Премиума">
      <p>{banner.text}</p>
      <div className="td-offer-banner__actions">
        <Link to={banner.cta_href || "/pricing?promo=potok1110"} className="td-button td-button-primary">
          {banner.cta_label || "Выбрать „Репетитор“"}
        </Link>
        <button type="button" className="td-onboarding__dismiss" onClick={dismiss}>
          Скрыть
        </button>
      </div>
    </aside>
  );
}
