import { Link } from "react-router-dom";
import { charityImg, FUNDRAISER_PATH, QR_ALT } from "../pages/christmasFundraiserData";
import { useFundraiserSnapshot } from "../pages/fundraiserAmount";
import FundraiserCollected from "./FundraiserCollected";
import "../pages/christmas-fundraiser.css";

export default function HomePiggyBank() {
  const snapshot = useFundraiserSnapshot();

  return (
    <section className="home-piggy" aria-labelledby="home-piggy-heading">
      <div className="home-piggy__copy">
        <p className="home-piggy__eyebrow" id="home-piggy-heading">🎄 Рождественский сбор</p>
        <FundraiserCollected snapshot={snapshot} />
        <Link className="xmas-btn xmas-btn--primary home-piggy__btn" to={FUNDRAISER_PATH}>
          Помочь сбору
        </Link>
      </div>
      <img className="home-piggy__qr" src={charityImg("qr.png")} alt={QR_ALT} width={180} height={180} />
    </section>
  );
}
